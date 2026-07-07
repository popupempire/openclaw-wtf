import SwiftUI

/// The Tasks tab: a list of submitted AI tasks with a compose button.
struct TasksTab: View {
    @Environment(TaskAssistantModel.self) private var taskModel
    @Environment(NodeAppModel.self) private var appModel
    @State private var showInputSheet = false

    var body: some View {
        NavigationStack {
            Group {
                if self.taskModel.tasks.isEmpty {
                    self.emptyState
                } else {
                    self.taskList
                }
            }
            .navigationTitle("Tasks")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        self.showInputSheet = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .disabled(self.appModel.gatewayServerName == nil)
                    .accessibilityLabel("New Task")
                }

                ToolbarItem(placement: .secondaryAction) {
                    Button("Clear Completed") {
                        withAnimation {
                            self.taskModel.clearCompleted()
                        }
                    }
                    .disabled(self.taskModel.tasks.allSatisfy { $0.status != .done && $0.status != .failed })
                }
            }
        }
        .sheet(isPresented: self.$showInputSheet) {
            TaskInputSheet(isPresented: self.$showInputSheet)
        }
    }

    // MARK: - Sub-views

    private var emptyState: some View {
        VStack(spacing: 16) {
            Image(systemName: "list.bullet.clipboard")
                .font(.system(size: 48))
                .foregroundStyle(.secondary)

            Text("No tasks yet")
                .font(.title3)
                .fontWeight(.semibold)

            Text("Tap + to submit a task for the AI assistant to execute.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)

            if self.appModel.gatewayServerName == nil {
                Label("Connect to a gateway to run tasks", systemImage: "wifi.slash")
                    .font(.caption)
                    .foregroundStyle(.orange)
                    .padding(.top, 4)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var taskList: some View {
        List {
            ForEach(self.taskModel.tasks) { item in
                TaskRowView(item: item)
                    .swipeActions(edge: .trailing) {
                        if item.status == .running || item.status == .pending {
                            Button(role: .destructive) {
                                self.taskModel.cancelTask(item)
                            } label: {
                                Label("Cancel", systemImage: "stop.circle")
                            }
                        }
                        Button(role: .destructive) {
                            withAnimation {
                                self.taskModel.removeTask(id: item.id)
                            }
                        } label: {
                            Label("Delete", systemImage: "trash")
                        }
                    }
            }
        }
        .listStyle(.insetGrouped)
        .animation(.default, value: self.taskModel.tasks.map { $0.id })
    }
}
