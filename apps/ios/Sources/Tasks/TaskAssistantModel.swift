import OpenClawKit
import OpenClawProtocol
import Foundation
import Observation
import OSLog

private let logger = Logger(subsystem: "ai.openclaw", category: "task-assistant")

/// Observable model that manages submitted AI tasks and routes gateway events back to them.
@MainActor
@Observable
final class TaskAssistantModel {
    private(set) var tasks: [TaskItem] = []

    private weak var appModel: NodeAppModel?
    private var listenTask: Task<Void, Never>?

    init(appModel: NodeAppModel) {
        self.appModel = appModel
    }

    /// Start listening to gateway events. Call once from the UI (e.g. `.task` on the root view).
    func start() {
        self.startListening()
    }

    // MARK: - Public API

    /// Submit a new task prompt. Returns the new TaskItem so the caller can display it immediately.
    @discardableResult
    func submitTask(prompt: String, thinking: String? = nil) async -> TaskItem {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let task = TaskItem(prompt: trimmed.isEmpty ? prompt : trimmed)
        // Use a dedicated session key so we can correlate chat events back to this task.
        let sessionKey = "task:\(task.id)"
        self.tasks.insert(task, at: 0)

        do {
            guard let appModel else { throw TaskAssistantError.notConnected }
            let link = AgentDeepLink(
                message: task.prompt,
                sessionKey: sessionKey,
                thinking: thinking,
                deliver: false,
                to: nil,
                channel: nil,
                timeoutSeconds: nil,
                key: task.id)
            task.status = .running
            try await appModel.sendAgentRequest(link: link)
        } catch {
            task.status = .failed
            task.errorMessage = error.localizedDescription
            logger.error("submitTask failed: \(error.localizedDescription, privacy: .public)")
        }

        return task
    }

    func cancelTask(_ item: TaskItem) {
        guard item.status == .pending || item.status == .running else { return }
        item.status = .failed
        item.errorMessage = "Cancelled"
    }

    func clearCompleted() {
        self.tasks.removeAll { $0.status == .done || $0.status == .failed }
    }

    func removeTask(id: String) {
        self.tasks.removeAll { $0.id == id }
    }

    // MARK: - Gateway event listener

    private func startListening() {
        self.listenTask?.cancel()
        guard let appModel else { return }
        let gateway = appModel.gatewaySession
        self.listenTask = Task { [weak self] in
            let stream = await gateway.subscribeServerEvents()
            for await evt in stream {
                if Task.isCancelled { return }
                await MainActor.run { [weak self] in
                    self?.handleGatewayEvent(evt)
                }
            }
        }
    }

    private func handleGatewayEvent(_ evt: EventFrame) {
        switch evt.event {
        case "chat":
            guard let payload = evt.payload,
                  let chatEvt = try? GatewayPayloadDecoding.decode(payload, as: OpenClawChatEventPayload.self)
            else { return }
            self.handleChatEvent(chatEvt)
        case "agent":
            guard let payload = evt.payload,
                  let agentEvt = try? GatewayPayloadDecoding.decode(payload, as: OpenClawAgentEventPayload.self)
            else { return }
            self.handleAgentEvent(agentEvt)
        default:
            break
        }
    }

    /// Match a `chat` event to a TaskItem via its task-scoped session key.
    private func handleChatEvent(_ evt: OpenClawChatEventPayload) {
        guard let sessionKey = evt.sessionKey,
              sessionKey.hasPrefix("task:"),
              let task = self.tasks.first(where: { "task:\($0.id)" == sessionKey })
        else { return }

        guard task.status == .running || task.status == .pending else { return }

        let state = evt.state ?? ""

        if state == "done" {
            // Extract final reply text from message payload.
            let replyText: String? = {
                guard let msg = evt.message else { return nil }
                if let dict = msg.value as? [String: Any],
                   let content = dict["content"]
                {
                    if let str = content as? String { return str }
                    if let arr = content as? [[String: Any]] {
                        return arr.compactMap { $0["text"] as? String }.joined(separator: "\n")
                    }
                }
                if let str = msg.value as? String { return str }
                return nil
            }()
            task.result = replyText
            task.status = .done
        } else if state == "error" {
            task.errorMessage = evt.errorMessage ?? "Unknown error"
            task.status = .failed
        }
    }

    /// Capture the runId from the first agent event so we can associate it for debugging/cancellation.
    private func handleAgentEvent(_ evt: OpenClawAgentEventPayload) {
        // Correlate via the `key` field we embedded in the AgentDeepLink — it comes back as the label.
        // The gateway puts our `key` into the idempotencyKey or label field.  We instead match via
        // session key on the chat event, so here we only capture the runId for future use.
        //
        // If a task's sessionKey matches and the runId is not yet set, record it.
        let runId = evt.runId
        if let task = self.tasks.first(where: { $0.runId == nil && $0.status == .running }) {
            // Heuristic: if there's only one running task, assign the runId to it.
            if self.tasks.filter({ $0.status == .running }).count == 1 {
                task.runId = runId
            }
        }
    }
}

private enum TaskAssistantError: LocalizedError {
    case notConnected

    var errorDescription: String? {
        switch self {
        case .notConnected: "Not connected to gateway"
        }
    }
}
