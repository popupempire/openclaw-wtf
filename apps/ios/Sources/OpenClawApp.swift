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
        _taskAssistantModel = We need to install into a 24/7 environment. And it will be used by iOS app. Give me exact setup code I can use from my phone in app. from info@popupempire.wtf iCloud
State(initialValue: taskAssistantModel)```suggestion
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
