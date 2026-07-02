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

        switch evt.state {
        case "final":
            // Capture any text that was streamed in via agent events before the run finished.
            task.result = task.streamingText.flatMap { $0.isEmpty ? nil : $0 }
            task.streamingText = nil
            task.status = .done
        case "aborted":
            task.streamingText = nil
            task.errorMessage = "Aborted"
            task.status = .failed
        case "error":
            task.streamingText = nil
            task.errorMessage = evt.errorMessage ?? "Unknown error"
            task.status = .failed
        default:
            break
        }
    }

    /// Stream assistant text from agent events and assign runId to the matching task.
    private func handleAgentEvent(_ evt: OpenClawAgentEventPayload) {
        // Assign runId to the matching running task (heuristic: one running task).
        let runId = evt.runId
        if let task = self.tasks.first(where: { $0.runId == nil && $0.status == .running }),
           self.tasks.filter({ $0.status == .running }).count == 1
        {
            task.runId = runId
        }

        // Accumulate streaming assistant text so we can capture it on "final".
        guard let task = self.tasks.first(where: { $0.runId == runId }),
              evt.stream == "assistant",
              let text = evt.data["text"]?.value as? String
        else { return }
        task.streamingText = (task.streamingText ?? "") + text
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
