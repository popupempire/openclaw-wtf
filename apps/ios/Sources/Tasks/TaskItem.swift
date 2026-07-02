import Foundation
import Observation

/// A single task submitted to the virtual AI assistant.
@MainActor
@Observable
final class TaskItem: Identifiable {
    enum Status {
        case pending
        case running
        case done
        case failed
    }

    let id: String
    let prompt: String
    let createdAt: Date
    var status: Status
    var result: String?
    var errorMessage: String?
    /// The runId returned by the gateway when the agent starts.
    var runId: String?
    /// Accumulates streaming assistant text from agent events; captured into `result` on "final".
    var streamingText: String?

    init(id: String = UUID().uuidString, prompt: String) {
        self.id = id
        self.prompt = prompt
        self.createdAt = Date()
        self.status = .pending
    }
}
