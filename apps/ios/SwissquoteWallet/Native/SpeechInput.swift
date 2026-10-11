import AVFoundation
import Observation
import Speech

/// MOCK of Swiss-hosted speech-to-text: Apple's speech recognition, on the phone itself when the language
/// supports it. Listens once and writes what it hears into `text` as the client speaks.
@Observable
final class SpeechInput {
    private(set) var listening = false
    private(set) var text = ""
    private(set) var error: String?

    @ObservationIgnored private let audio = AVAudioEngine()
    @ObservationIgnored private var request: SFSpeechAudioBufferRecognitionRequest?
    @ObservationIgnored private var task: SFSpeechRecognitionTask?

    /// The assistant's languages, as Swiss locales.
    private static let locales = ["en": "en-GB", "fr": "fr-CH", "de": "de-CH", "it": "it-CH"]

    func start(language: String) async {
        error = nil
        text = ""
        guard await Self.authorized() else {
            error = "Please allow the microphone and speech recognition in Settings to speak to the assistant."
            return
        }
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: Self.locales[language] ?? "en-GB")), recognizer.isAvailable else {
            error = "Voice is not available on this phone right now. Please type instead."
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record, mode: .measurement, options: .duckOthers)
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let request = SFSpeechAudioBufferRecognitionRequest()
            request.shouldReportPartialResults = true
            if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
            self.request = request

            let input = audio.inputNode
            input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in
                request.append(buffer)
            }
            audio.prepare()
            try audio.start()
            listening = true

            task = recognizer.recognitionTask(with: request) { [weak self] result, failure in
                let heard = result?.bestTranscription.formattedString
                let final = result?.isFinal == true || failure != nil
                Task { @MainActor in
                    guard let self else { return }
                    if let heard { self.text = heard }
                    if final { self.stop() }
                }
            }
        } catch {
            self.error = "Voice could not start: \(error.localizedDescription)"
            stop()
        }
    }

    func stop() {
        guard listening || request != nil else { return }
        audio.stop()
        audio.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        listening = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private static func authorized() async -> Bool {
        let speech = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0 == .authorized) }
        }
        guard speech else { return false }
        return await AVAudioApplication.requestRecordPermission()
    }
}
