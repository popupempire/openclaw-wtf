import SwiftUI

/// A single row in the task list showing status, title, elapsed time, and expandable result.
struct TaskRowView: View {
    var item: TaskItem
    @State private var expanded = false

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top, spacing: 10) {
                self.statusIcon
                    .frame(width: 22, height: 22)

                VStack(alignment: .leading, spacing: 2) {
                    Text(item.prompt)
                        .font(.subheadline)
                        .lineLimit(self.expanded ? nil : 2)

                    self.metaLine
                }

                Spacer(minLength: 0)

                if item.result != nil || item.errorMessage != nil {
                    Button {
                        withAnimation(.easeInOut(duration: 0.18)) {
                            self.expanded.toggle()
                        }
                    } label: {
                        Image(systemName: self.expanded ? "chevron.up" : "chevron.down")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                }
            }

            if self.expanded {
                self.expandedContent
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .onTapGesture {
            guard item.result != nil || item.errorMessage != nil else { return }
            withAnimation(.easeInOut(duration: 0.18)) {
                self.expanded.toggle()
            }
        }
    }

    // MARK: - Sub-views

    @ViewBuilder
    private var statusIcon: some View {
        switch item.status {
        case .pending:
            Image(systemName: "clock")
                .foregroundStyle(.secondary)
        case .running:
            ProgressView()
                .controlSize(.small)
        case .done:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case .failed:
            Image(systemName: "xmark.circle.fill")
                .foregroundStyle(.red)
        }
    }

    private var metaLine: some View {
        HStack(spacing: 6) {
            Text(item.status.label)
                .font(.caption)
                .foregroundStyle(item.status.color)

            Text("·")
                .font(.caption)
                .foregroundStyle(.tertiary)

            Text(item.createdAt, style: .relative)
                .font(.caption)
                .foregroundStyle(.tertiary)
        }
    }

    @ViewBuilder
    private var expandedContent: some View {
        if let result = item.result, !result.isEmpty {
            Text(result)
                .font(.footnote)
                .foregroundStyle(.primary)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
        } else if let errorMessage = item.errorMessage, !errorMessage.isEmpty {
            Text(errorMessage)
                .font(.footnote)
                .foregroundStyle(.red)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 8))
        }
    }
}

// MARK: - Status helpers

extension TaskItem.Status {
    var label: String {
        switch self {
        case .pending: "Pending"
        case .running: "Running"
        case .done: "Done"
        case .failed: "Failed"
        }
    }

    var color: Color {
        switch self {
        case .pending: .secondary
        case .running: .accentColor
        case .done: .green
        case .failed: .red
        }
    }
}
