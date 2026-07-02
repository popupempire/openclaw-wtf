import SwiftUI

@main
struct OpenClawApp: App {
    @State private var appModel: NodeAppModel
    @State private var gatewayController: GatewayConnectionController
    @State private var taskAssistantModel: TaskAssistantModel
    @Environment(\.scenePhase) private var scenePhase

    init() {
        GatewaySettingsStore.bootstrapPersistence()
        let appModel = NodeAppModel()
        let taskAssistantModel = TaskAssistantModel(appModel: appModel)
        _appModel = State(initialValue: appModel)
        _gatewayController = State(initialValue: GatewayConnectionController(appModel: appModel))
        _taskAssistantModel = State(initialValue: taskAssistantModel)
    }

    var body: some Scene {
        WindowGroup {
            RootCanvas()
                .environment(self.appModel)
                .environment(self.appModel.voiceWake)
                .environment(self.gatewayController)
                .environment(self.taskAssistantModel)
                .task {
                    self.taskAssistantModel.start()
                }
                .onOpenURL { url in
                    Task { await self.appModel.handleDeepLink(url: url) }
                }
                .onChange(of: self.scenePhase) { _, newValue in
                    self.appModel.setScenePhase(newValue)
                    self.gatewayController.setScenePhase(newValue)
                }
        }
    }
}
