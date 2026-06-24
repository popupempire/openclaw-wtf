import SwiftUI

/// Sheet for composing a new task prompt with optional thinking level selection.
struct TaskInputSheet: View {
    @Environment(TaskAssistantModel.self) private var taskModel
    @Binding var isPresented: Bool

    @State private var promptText = ""
    @State private var thinking: ThinkingLevel = .low
    @FocusState private var promptFocused: Bool

    enum ThinkingLevel: String, CaseIterable {
        case low
        case medium = "medium"
        case high

        var label: String {
            switch self {
            case .low: "Low"
            case .medium: "Medium"
            case .high: "High"
            }
        }
    }

    private var trimmedPrompt: String { self.promptText.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var canSubmit: Bool { !self.trimmedPrompt.isEmpty }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ZStack(alignment: .topLeading) {
                        if self.promptText.isEmpty {
                            Text("Describe the task…")
                                .foregroundStyle(.placeholder)
                                .padding(.top, 8)
                                .padding(.leading, 4)
                                .allowsHitTesting(false)
                        }
                        TextEditor(text: self.$promptText)
                            .frame(minHeight: 120)
                            .focused(self.$promptFocused)
                    }
                } header: {
                    Text("Task")
                }

                Section {
                    Picker("Thinking", selection: self.$thinking) {
                        ForEach(ThinkingLevel.allCases, id: \.self) { level in
                            Text(level.label).tag(level)
                        }
                    }
                    .pickerStyle(.segmented)
                } header: {
                    Text("Thinking level")
                } footer: {
                    Text("Higher thinking produces more thorough reasoning at the cost of speed.")
                        .font(.caption)
                }
            }
            .navigationTitle("New Task")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        self.isPresented = false
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Submit") {
                        self.submit()
                    }
                    .disabled(!self.canSubmit)
                }
            }
        }
        .onAppear { self.promptFocused = true }
    }

    private func submit() {
        let prompt = self.trimmedPrompt
        let thinkingValue = self.thinking == .low ? nil : self.thinking.rawValue
        self.isPresented = false
        Task {
            await self.taskModel.submitTask(prompt: prompt, thinking: thinkingValue)
        }
    }
}
