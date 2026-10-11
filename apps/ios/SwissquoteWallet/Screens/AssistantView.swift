import SwiftUI

/// The assistant (CLAUDE.md section 9): "Send 50 USDC to my son", "Exchange 5 USDC for ETH", "Put my ETH
/// in Aave", "Approve Uniswap", "Add Marc as a contact". The model drafts, the rules decide (in the wallet
/// core, as on the web), and the client confirms each step with Face ID or declines. No message can skip
/// that step. Mirrors apps/web/app/assistant/page.tsx.
struct AssistantView: View {
    let profile: WalletProfile

    private struct Message: Identifiable {
        let id = UUID()
        let fromClient: Bool
        let text: String
        /// trustApp or addContact: a step the client takes from the chat.
        var action: JSONValue?
    }

    private enum Phase {
        case chat
        case confirmBitcoin(PreparedPayment)
        case confirmUsdc(UsdcPayment)
        case sentBitcoin(PreparedPayment, PaymentResult)
        case sentUsdc(UsdcPayment, String)
        case appConfirm(DefiApp, AppUse)
        case appDone(DefiApp, AppUse, String)
    }

    @Environment(Session.self) private var session
    @Environment(WalletCore.self) private var core
    @Environment(Navigation.self) private var navigation

    @State private var setup: JSONValue?
    @State private var language = "en"
    @State private var contacts: [Contact] = []
    @State private var messages: [Message] = []
    @State private var said: [String] = []
    @State private var pending: JSONValue?
    @State private var input = ""
    @State private var busy = false
    @State private var model: String?
    @State private var phase = Phase.chat
    @State private var speech = SpeechInput()

    var body: some View {
        switch phase {
        case .chat: chat
        case .confirmBitcoin(let payment):
            BitcoinConfirmView(payment: payment, onCancel: decline) { phase = .sentBitcoin(payment, $0) }
        case .confirmUsdc(let payment):
            UsdcConfirmView(payment: payment, onCancel: decline) { phase = .sentUsdc(payment, $0) }
        case .sentBitcoin(let payment, let result):
            BitcoinSentView(payment: payment, result: result) { phase = .chat }
        case .sentUsdc(let payment, let hash):
            UsdcSentAgain(payment: payment, txHash: hash) { phase = .chat }
        case .appConfirm(let app, let use):
            AppConfirmView(app: app, use: use, onCancel: decline) { phase = .appDone(app, use, $0) }
        case .appDone(let app, let use, let hash):
            AppDoneView(app: app, use: use, txHash: hash) {
                phase = .chat
                navigation.tab = .home
            }
        }
    }

    private var chat: some View {
        ScrollViewReader { scroller in
            Screen(tabs: true) {
                HStack {
                    Text("Assistant").titleStyle()
                    Spacer()
                    Menu {
                        Picker("Language", selection: $language) {
                            ForEach(setup?["languages"].array.indices ?? 0..<0, id: \.self) { index in
                                let option = setup!["languages"][index]
                                Text(option["name"].string ?? "").tag(option["id"].string ?? "en")
                            }
                        }
                    } label: {
                        HStack(spacing: 8) {
                            Text(languageName).font(.geist(15.75, .semibold))
                            Image(systemName: "chevron.down").font(.geist(11, .bold)).foregroundStyle(Theme.inkSoft)
                        }
                        .foregroundStyle(Theme.ink)
                        .padding(.horizontal, 16)
                        .frame(minHeight: 40)
                        .background(Theme.surface, in: .capsule)
                        .overlay(Capsule().strokeBorder(Theme.line, lineWidth: 1))
                    }
                    .accessibilityLabel("Language: \(languageName)")
                    .onChange(of: language) { if messages.count <= 1 { Task { await loadSetup() } } }
                }
                ForEach(messages) { message in bubble(message).id(message.id) }
                if busy { Text("…").font(Theme.Text.m).foregroundStyle(Theme.inkSoft).padding(.horizontal, 16).padding(.vertical, 12).background(Theme.surface, in: .rect(cornerRadius: 18)).id("busy") }
                if messages.count <= 1 {
                    FlowSuggestions(suggestions: setup?["suggestions"].array.compactMap(\.string) ?? []) { send($0) }
                        .disabled(busy || session.price == nil)
                }
                if let model {
                    Text("Understood by \(model). It only sees your request and your contacts’ first names, never who you are.").smallMuted()
                }
            } actions: {
                composer
            }
            .onChange(of: messages.count) { if let last = messages.last { withAnimation { scroller.scrollTo(last.id, anchor: .bottom) } } }
        }
        .task {
            await loadSetup()
            contacts = ((try? await core.call("loadRulebook", profile.walletId))?["contacts"].array ?? []).map(Contact.init(json:))
            takeHandedOverRequest()
        }
        .onChange(of: navigation.assistantRequest) { takeHandedOverRequest() }
        .onChange(of: speech.text) { if speech.listening { input = speech.text } }
        .onChange(of: speech.error) { if let error = speech.error { say(error) } }
    }

    /// The request field and its two round buttons (`.composer`), then the promise that nothing happens
    /// without Face ID.
    private var composer: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                InputField(placeholder: setup?["example"].string ?? "", text: $input, label: "Your request")
                    .submitLabel(.send)
                    .onSubmit { send(input) }
                    .disabled(busy)
                Button {
                    if speech.listening { speech.stop() } else { Task { await speech.start(language: language) } }
                } label: {
                    Icon("mic")
                        .frame(width: 60, height: 60)
                        .foregroundStyle(speech.listening ? Theme.onBrand : Theme.ink)
                        .background(speech.listening ? Theme.brand : Theme.surface, in: .circle)
                        .overlay(Circle().strokeBorder(speech.listening ? Theme.brand : Theme.ink, lineWidth: 1))
                }
                .buttonStyle(.pressable)
                .accessibilityLabel(speech.listening ? "Stop listening" : "Speak your request")
                .disabled(busy)
                let empty = input.trimmingCharacters(in: .whitespaces).isEmpty
                Button { send(input) } label: {
                    Icon("send")
                        .frame(width: 60, height: 60)
                        .foregroundStyle(Theme.onBrand)
                        .background(Theme.brand, in: .circle)
                        .opacity(busy || empty || session.price == nil ? 0.45 : 1)
                }
                .buttonStyle(.pressable)
                .accessibilityLabel("Send to the assistant")
                .disabled(busy || empty || session.price == nil)
            }
            Text("The assistant only prepares. Nothing happens until you confirm with Face ID.").smallMuted()
            HStack(spacing: 6) {
                Text("Voice:").smallMuted()
                MockTag(text: "Apple speech recognition")
            }
        }
    }

    private var languageName: String {
        setup?["languages"].array.first { $0["id"].string == language }?["name"].string ?? "English"
    }

    /// `.bubble.client` (dark, on the right) and `.bubble.assistant` (white, on the left).
    private func bubble(_ message: Message) -> some View {
        let client = message.fromClient
        let shape = UnevenRoundedRectangle(topLeadingRadius: 18, bottomLeadingRadius: client ? 18 : 6,
                                           bottomTrailingRadius: client ? 6 : 18, topTrailingRadius: 18)
        return HStack {
            if client { Spacer(minLength: 40) }
            VStack(alignment: .leading, spacing: 12) {
                Text(message.text).font(Theme.Text.m)
                if let action = message.action { ChatAction(action: action, language: language) { say($0) } }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .foregroundStyle(client ? Color.white : Theme.ink)
            .background(client ? Theme.night : Theme.surface, in: shape)
            .overlay { if !client { shape.strokeBorder(Theme.line, lineWidth: 1) } }
            .cardShadow()
            if !client { Spacer(minLength: 40) }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel((client ? "You: " : "Assistant: ") + message.text)
    }

    // MARK: - Conversation

    private func loadSetup() async {
        setup = try? await core.call("assistant.setup", profile.client.firstName, language)
        if messages.count <= 1, let greeting = setup?["greeting"].string {
            messages = [Message(fromClient: false, text: greeting)]
        }
    }

    /// A request typed in the home screen's box.
    private func takeHandedOverRequest() {
        guard let request = navigation.assistantRequest, setup != nil, session.price != nil else { return }
        navigation.assistantRequest = nil
        send(request)
    }

    private func say(_ text: String, action: JSONValue? = nil) {
        messages.append(Message(fromClient: false, text: text, action: action))
    }

    private func send(_ text: String) {
        let request = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !request.isEmpty, !busy, let price = session.price else { return }
        speech.stop()
        input = ""
        messages.append(Message(fromClient: true, text: request))
        busy = true
        Task {
            defer { busy = false }
            do {
                let turnInput: JSONValue = .object([
                    "text": .string(request),
                    "pending": pending ?? .null,
                    "said": .array(said.map(JSONValue.string)),
                    "contacts": .array(contacts.map(\.json)),
                    "language": .string(language),
                    "prices": .object(["btcChf": .number(price.btcChf), "usdcChf": .number(price.usdcChf), "ethChf": .number(price.ethChf)]),
                ])
                let turn = try await core.call("assistant.turn", turnInput)
                if let next = turn["language"].string, next != language { language = next }
                if let name = turn["model"].string { model = name }
                pending = turn["pending"].isNull ? nil : turn["pending"]
                said = turn["said"].array.compactMap(\.string)
                say(turn["reply"].string ?? "", action: turn["action"].isNull ? nil : turn["action"])
                try openCard(turn)
            } catch {
                pending = nil
                said = []
                say(error.localizedDescription)
            }
        }
    }

    /// A prepared payment or app operation opens its confirmation card.
    private func openCard(_ turn: JSONValue) throws {
        let payment = turn["payment"]
        if !payment.isNull {
            if payment["asset"].string == "BTC" { phase = .confirmBitcoin(try payment["payment"].decoded()) }
            else { phase = .confirmUsdc(try payment["payment"].decoded()) }
        }
        let appUse = turn["appUse"]
        if !appUse.isNull {
            phase = .appConfirm(DefiApp(id: appUse["app"]["id"].string ?? "", name: appUse["app"]["name"].string ?? ""), AppUse(json: appUse["use"]))
        }
    }

    private func decline() {
        Task { say((try? await core.call("assistant.text", language, "declined"))?.string ?? "Declined. Nothing was sent.") }
        phase = .chat
    }
}

/// The step a chat message offers: approve an app with Face ID, or open the contact form with the name filled in.
private struct ChatAction: View {
    let action: JSONValue
    let language: String
    let onDone: (String) -> Void

    @Environment(WalletCore.self) private var core
    @Environment(Navigation.self) private var navigation
    @State private var label = ""
    @State private var state = "idle"

    var body: some View {
        Group {
            if state != "done" {
                Button(state == "busy" ? "Waiting for Face ID…" : label) { Task { await run() } }
                    .buttonStyle(action["kind"].string == "addContact" ? AnyButtonStyle(.secondary) : AnyButtonStyle(.primary))
                    .disabled(state == "busy" || label.isEmpty)
            }
        }
        .task {
            let isContact = action["kind"].string == "addContact"
            let name = isContact ? action["name"] : action["appName"]
            label = (try? await core.call("assistant.text", language, isContact ? "newContactButton" : "trustButton", [name]))?.string ?? ""
        }
    }

    private func run() async {
        if action["kind"].string == "addContact" {
            navigation.contactToAdd = action["name"].string
            navigation.tab = .rules
            return
        }
        state = "busy"
        do {
            try await core.call("requestChange", JSONValue.object(["kind": "addApp", "appId": action["appId"]]))
            state = "done"
            onDone((try? await core.call("assistant.text", language, "trustRequested", [action["appName"]]))?.string ?? "Requested.")
        } catch {
            state = "idle"
            onDone(error.localizedDescription)
        }
    }
}

/// Suggestions shown before the first request, wrapping like words.
private struct FlowSuggestions: View {
    let suggestions: [String]
    let onPick: (String) -> Void

    var body: some View {
        FlowLayout(spacing: 8) {
            ForEach(suggestions, id: \.self) { suggestion in
                Button { onPick(suggestion) } label: {
                    Text(suggestion)
                        .font(.geist(15.75, .medium))
                        .foregroundStyle(Theme.ink)
                        .padding(.horizontal, 16)
                        .frame(minHeight: 40)
                        .background(Theme.surface, in: .capsule)
                        .overlay(Capsule().strokeBorder(Theme.line, lineWidth: 1))
                }
                .buttonStyle(.pressable)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Suggestions")
    }
}

/// The USDC result screen, reached from the assistant.
private struct UsdcSentAgain: View {
    let payment: UsdcPayment
    let txHash: String
    let onDone: () -> Void
    @Environment(Navigation.self) private var navigation

    var body: some View {
        Screen {
            Text("Sent to \(payment.contact.name)").titleStyle()
            Notice(.ok) {
                Text("\(payment.contact.name) has received \(Format.usdc(payment.amount)): Base confirms payments within seconds.")
                ExplorerLink(label: "View payment \(Format.shortId(txHash)) on Base", url: Explorer.baseTx(txHash))
            }
        } actions: {
            Button("Back to my safe") {
                onDone()
                navigation.tab = .home
            }
            .buttonStyle(.primary)
        }
    }
}

/// Lets one button pick its style at run time.
struct AnyButtonStyle: ButtonStyle {
    private let make: (Configuration) -> AnyView
    init<S: ButtonStyle>(_ style: S) { make = { AnyView(style.makeBody(configuration: $0)) } }
    func makeBody(configuration: Configuration) -> some View { make(configuration) }
}

extension JSONValue {
    /// The JSON as a Swift type (a prepared payment from the assistant).
    func decoded<T: Decodable>(as type: T.Type = T.self) throws -> T {
        try JSONDecoder().decode(T.self, from: JSONEncoder().encode(self))
    }
}
