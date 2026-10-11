import XCTest

/// Drives the demo script's acts (docs/demo-script.md) through the real screens, against `pnpm dev`.
/// Face ID: run with Face ID enrolled and "Matching Face" sent at each prompt (scripts/ui-test.sh does it).
/// The recovery key is a passkey saved in the Simulator's Passwords (the "synced passkey" option).
final class WalletUITests: XCTestCase {
    private var app: XCUIApplication!
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-freshPhone"]
        // scripts/ui-test.sh passes SQW_SERVER_URL to run against the Mac's tunnel instead of localhost.
        if let server = ProcessInfo.processInfo.environment["SQW_SERVER_URL"], !server.isEmpty {
            app.launchArguments += ["-SQWServerURL", server]
        }
        app.launch()
    }

    /// Acts 1, 4 (offline switch) and 5: open a safe, receive, Swissquote offline, lose the phone, recover.
    func testCoreStory() {
        let clientNumber = "CH-4417-\(Int.random(in: 3000...9999))"
        openSafe(clientNumber: clientNumber)

        // Receive: the Savings safe's address as a QR code, and the Mock transfer offered.
        tap("Receive")
        XCTAssertTrue(app.images["QR code of your Savings safe address"].waitForExistence(timeout: 10))
        let savingsAddress = app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH 'tb1q'")).firstMatch.label
        XCTAssertTrue(savingsAddress.hasPrefix("tb1q"))
        XCTAssertTrue(app.buttons["Transfer from my Swissquote account"].exists)
        app.navigationBars.buttons.element(boundBy: 0).tap()

        // Act 4, step 1: Swissquote offline, then back.
        tap("Demo panel")
        tap("Switch off")
        XCTAssertTrue(app.buttons["Bring back"].waitForExistence(timeout: 10))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        XCTAssertTrue(text(containing: "Swissquote is offline").waitForExistence(timeout: 30), "Home does not say Swissquote is offline")
        attach("home-swissquote-offline")
        tap("Demo panel")
        tap("Bring back")
        XCTAssertTrue(app.buttons["Switch off"].waitForExistence(timeout: 10))

        // Act 5: lose this phone, then bring the safe back with the recovery key and the face check.
        XCTAssertTrue(app.buttons["Lose this phone"].waitForExistence(timeout: 15))
        app.swipeUp()
        tap("Lose this phone")
        tap("Yes, delete it from this phone")
        // Still logged in to Swissquote (Mock): the app finds the safe and offers to bring it back.
        tap("Bring my safe to this phone")
        tap("Continue")
        tap("Use Face ID")
        tap("Use my recovery key")
        useRecoveryKeyOnPage("Use my recovery key")
        tap("Start the face check")
        XCTAssertTrue(app.staticTexts["Your safe is on its way"].waitForExistence(timeout: 60), app.debugDescription)
        attach("recovery-waiting")
        let restore = app.buttons["Bring my safe back"]
        XCTAssertTrue(restore.waitForExistence(timeout: 120), "The waiting period did not end")
        restore.tap()
        XCTAssertTrue(app.staticTexts["Your safe is back"].waitForExistence(timeout: 120), app.debugDescription)
        attach("recovery-done")
        tap("Go to my safe")

        // The same Savings safe, now opened by this phone's new key piece.
        XCTAssertTrue(app.staticTexts["Your pockets"].waitForExistence(timeout: 30))
        tap("Receive")
        XCTAssertTrue(app.staticTexts[savingsAddress].waitForExistence(timeout: 10), "The recovered safe has another Savings address")
    }

    /// Step 4 without test coins: the rulebook (a new contact waits and can be cancelled), Attacker mode
    /// (Act 3: the CHF 5,000 payment and the recovery are refused), Alerts, Activity and the plan.
    func testRulesAttackerAndAlerts() {
        openSafe(clientNumber: "CH-4417-\(Int.random(in: 3000...9999))")

        // Rules: add Marc. Swissquote checks him first, then Face ID, then the waiting period.
        app.tabBars.buttons["Rules"].tap()
        XCTAssertTrue(app.staticTexts["Contacts and rules"].waitForExistence(timeout: 30))
        tap("Add a contact")
        app.textFields["Name"].tap()
        app.textFields["Name"].typeText("Marc")
        app.textFields["Their Bitcoin address"].tap()
        app.textFields["Their Bitcoin address"].typeText("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx")
        tap("Check with Swissquote")
        XCTAssertTrue(text(containing: "Checked by Swissquote").waitForExistence(timeout: 30), app.debugDescription)
        tap("Add with Face ID")
        XCTAssertTrue(text(containing: "Adding Marc").waitForExistence(timeout: 60), app.debugDescription)
        XCTAssertTrue(text(containing: "Takes effect in").exists)
        attach("rules-pending-contact")
        tap("Cancel")
        XCTAssertTrue(text(containing: "Adding Marc").waitForNonExistence(timeout: 30))

        // Tightening is instant: freeze, then unfreezing waits.
        app.swipeUp()
        tap("Freeze my safe")
        XCTAssertTrue(text(containing: "your safe is frozen").waitForExistence(timeout: 60), app.debugDescription)
        app.swipeUp()
        tap("Unfreeze my safe")
        XCTAssertTrue(text(containing: "unfreezes after the waiting period").waitForExistence(timeout: 60), app.debugDescription)

        // Alerts: the Watcher reported the requests.
        app.tabBars.buttons["Home"].tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Alerts'")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Alerts"].waitForExistence(timeout: 10))
        XCTAssertTrue(text(containing: "Unfreeze the safe").waitForExistence(timeout: 30), app.debugDescription)
        tap("Cancel this change")
        attach("alerts")
        app.navigationBars.buttons.element(boundBy: 0).tap()

        // Activity: a new safe has none yet.
        tap("Activity")
        XCTAssertTrue(text(containing: "Nothing yet").waitForExistence(timeout: 60), app.debugDescription)
        app.navigationBars.buttons.element(boundBy: 0).tap()

        // Plan: Standard, then back to Premium.
        tap("Plan and settings")
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Standard'")).firstMatch.tap()
        XCTAssertTrue(text(containing: "you now pay the network fee").waitForExistence(timeout: 30))
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Premium'")).firstMatch.tap()
        XCTAssertTrue(text(containing: "Swissquote now pays your network fees").waitForExistence(timeout: 30))
        app.navigationBars.buttons.element(boundBy: 0).tap()

        // Act 3: Attacker mode.
        tap("Demo panel")
        tap("Start")
        XCTAssertTrue(app.staticTexts["Attacker mode"].waitForExistence(timeout: 10))
        app.buttons.matching(identifier: "Try it").element(boundBy: 0).tap()
        XCTAssertTrue(app.staticTexts["Stopped"].waitForExistence(timeout: 60), app.debugDescription)
        XCTAssertTrue(text(containing: "BLOCKED in bitcoin, BLOCKED in USDC").exists, app.debugDescription)
        app.swipeUp()
        app.buttons.matching(identifier: "Try it").element(boundBy: 2).tap()  // the recovery, after send's button is gone
        let stoppedTwice = NSPredicate(format: "count == 2")
        _ = XCTWaiter.wait(for: [expectation(for: stoppedTwice, evaluatedWith: app.staticTexts.matching(identifier: "Stopped"))], timeout: 60)
        XCTAssertEqual(app.staticTexts.matching(identifier: "Stopped").count, 2, app.debugDescription)
        attach("attacker")
    }

    /// Step 5 without test coins: Explore (catalogue, Uniswap's exchange panel and approval, WalletConnect
    /// screen) and the assistant (a request gets an answer: a card, a question, or why it cannot help).
    func testExploreAndAssistant() {
        openSafe(clientNumber: "CH-4417-\(Int.random(in: 3000...9999))")

        app.tabBars.buttons["Explore"].tap()
        XCTAssertTrue(app.staticTexts["Explore"].waitForExistence(timeout: 10))
        let uniswap = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Uniswap'")).firstMatch
        XCTAssertTrue(uniswap.waitForExistence(timeout: 30), app.debugDescription)
        uniswap.tap()
        XCTAssertTrue(app.staticTexts["Exchange USDC for ETH, and back"].waitForExistence(timeout: 10))
        app.swipeUp()
        XCTAssertTrue(app.buttons["Approve with Face ID"].waitForExistence(timeout: 60), app.debugDescription)
        attach("explore-uniswap")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        tap("Scan an app’s QR code")
        XCTAssertTrue(app.staticTexts["Connect an app"].waitForExistence(timeout: 10))
        attach("explore-connect")

        app.tabBars.buttons["Assistant"].tap()
        XCTAssertTrue(app.staticTexts["Assistant"].waitForExistence(timeout: 10))
        XCTAssertTrue(text(containing: "Elisabeth").waitForExistence(timeout: 30), "No greeting\n\(app.debugDescription)")
        app.buttons["Send 20 francs to Léo"].tap()
        // One answer from the assistant after the client's request: whatever it is, it is in plain words.
        let answers = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Assistant: '"))
        let two = NSPredicate(format: "count >= 2")
        _ = XCTWaiter.wait(for: [expectation(for: two, evaluatedWith: answers)], timeout: 60)
        let card = app.staticTexts["Check your payment"]
        XCTAssertTrue(card.exists || answers.count >= 2, app.debugDescription)
        attach("assistant")
    }

    /// Acts 1 and 2 (Bitcoin), 4: real payments on signet. Needs test bitcoin in Swissquote's demo account.
    func testPayments() throws {
        openSafe(clientNumber: "CH-4417-\(Int.random(in: 3000...9999))")

        // Act 1, step 7: CHF 100 to the Spending pocket, CHF 200 to the Savings safe (Mock transfer, real coins).
        tap("Receive")
        transfer(chf: "CHF 200.00")
        app.buttons["Spending pocket"].tap()
        transfer(chf: "CHF 100.00")
        app.navigationBars.buttons.element(boundBy: 0).tap()

        // Act 2, step 1: CHF 20 to Léo from the Spending pocket, Face ID only.
        pay(contact: "Léo", chf: "20", fromSavings: false)
        XCTAssertTrue(text(containing: "Payments from your Spending pocket only need your Face ID").exists)
        confirmAndExpectSent(to: "Léo")

        // Act 2, step 3: CHF 150 to Sofia from the Savings safe, Swissquote asks to check, then Face ID.
        pay(contact: "Sofia", chf: "150", fromSavings: true)
        tap("Yes, I want to make this payment")
        confirmAndExpectSent(to: "Sofia")

        // Act 4: Swissquote offline. CHF 10 to Léo from the pocket works as usual, phone only.
        app.tabBars.buttons["Home"].tap()
        tap("Demo panel")
        tap("Switch off")
        XCTAssertTrue(app.buttons["Bring back"].waitForExistence(timeout: 10))
        pay(contact: "Léo", chf: "10", fromSavings: false)
        confirmAndExpectSent(to: "Léo")
        // CHF 120 to Adam from the Savings safe: Face ID, then the recovery key, the safe-keeper co-signs.
        pay(contact: "Adam", chf: "120", fromSavings: true)
        XCTAssertTrue(text(containing: "Swissquote is offline, so your recovery key").exists)
        tap("Confirm with Face ID")
        useRecoveryKeyOnPage("Use my recovery key")
        XCTAssertTrue(app.staticTexts["Sent to Adam"].waitForExistence(timeout: 120), app.debugDescription)
        attach("sent-offline-savings")
        app.tabBars.buttons["Home"].tap()
        tap("Demo panel")
        tap("Bring back")
    }

    // MARK: - Steps

    private func logIn(_ clientNumber: String) {
        let field = app.textFields["Client number"]
        XCTAssertTrue(field.waitForExistence(timeout: 30))
        field.tap()
        field.clearAndType(clientNumber)
    }

    /// Act 1, steps 1 to 6: log in, Face ID, MPC key, Swissquote's check, recovery passkey, Premium, ready.
    private func openSafe(clientNumber: String) {
        logIn(clientNumber)
        tap("Log in")
        tap("Open my safe")
        tap("Use Face ID")
        XCTAssertTrue(app.staticTexts["Add your recovery key"].waitForExistence(timeout: 60), app.debugDescription)
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Passkey in your Apple'")).firstMatch.tap()
        tap("Create the passkey")
        useRecoveryKeyOnPage("Add my recovery key")
        XCTAssertTrue(app.staticTexts["Choose your plan"].waitForExistence(timeout: 60), app.debugDescription)
        tap("Continue with Premium")
        XCTAssertTrue(app.staticTexts["Your safe is ready"].waitForExistence(timeout: 30))
        attach("safe-ready")
        tap("Go to my safe")
        XCTAssertTrue(app.staticTexts["Your pockets"].waitForExistence(timeout: 30))
        XCTAssertTrue(text(containing: "Verified yours").waitForExistence(timeout: 30), "Swissquote's verification is not shown")
        attach("home")
    }

    private func transfer(chf: String) {
        tap("Transfer from my Swissquote account")
        tap(chf)
        let arrived = text(containing: "is on its way")
        let failed = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'not enough' OR label CONTAINS[c] 'demo account'")).firstMatch
        _ = arrived.waitForExistence(timeout: 60)
        if !arrived.exists, failed.exists {
            XCTFail("Swissquote's demo account could not send test bitcoin: \(failed.label)")
        }
        XCTAssertTrue(arrived.exists, app.debugDescription)
    }

    private func pay(contact: String, chf: String, fromSavings: Bool) {
        app.tabBars.buttons["Send"].tap()
        let person = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", contact)).firstMatch
        XCTAssertTrue(person.waitForExistence(timeout: 30))
        person.tap()
        let bitcoin = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Bitcoin'")).firstMatch
        if bitcoin.waitForExistence(timeout: 5) { bitcoin.tap() }
        let amount = app.textFields.matching(NSPredicate(format: "label BEGINSWITH 'Amount in Swiss francs'")).firstMatch
        XCTAssertTrue(amount.waitForExistence(timeout: 10))
        amount.typeText(chf)
        tap(fromSavings ? "Pay from my Savings safe" : "Continue")
        XCTAssertTrue(app.staticTexts["Check your payment"].waitForExistence(timeout: 60), app.debugDescription)
    }

    private func confirmAndExpectSent(to contact: String) {
        tap("Confirm with Face ID")
        XCTAssertTrue(app.staticTexts["Sent to \(contact)"].waitForExistence(timeout: 120), app.debugDescription)
        XCTAssertTrue(app.links.matching(NSPredicate(format: "label BEGINSWITH 'View payment'")).firstMatch.exists)
        attach("sent-to-\(contact)")
        tap("Back to my safe")
    }

    /// The recovery-key web page (ASWebAuthenticationSession): its button, then the system passkey sheet.
    /// Over a tunnel the page can show its button before its script has loaded, so the tap waits for the
    /// page to finish loading and is repeated until the passkey sheet appears.
    private func useRecoveryKeyOnPage(_ label: String) {
        let button = app.webViews.buttons[label]
        XCTAssertTrue(button.waitForExistence(timeout: 60), "The recovery key page did not open\n\(app.debugDescription)")
        let loading = app.buttons.matching(identifier: "ReloadButton").matching(NSPredicate(format: "label == 'Stop'")).firstMatch
        let loaded = NSPredicate(format: "exists == false")
        _ = XCTWaiter.wait(for: [expectation(for: loaded, evaluatedWith: loading)], timeout: 60)
        for _ in 0..<3 {
            if button.exists && button.isEnabled { button.tap() }
            if passkeyButton.waitForExistence(timeout: 10) { break }
        }
        approvePasskey()
    }

    private var passkeyButton: XCUIElement {
        springboard.buttons.matching(NSPredicate(format: "label IN {'Add Passkey', 'Continue', 'Sign In', 'Use Passkey'}")).firstMatch
    }

    /// The system passkey sheet (save or use the recovery passkey); Face ID is answered by the test script.
    private func approvePasskey() {
        let button = passkeyButton
        XCTAssertTrue(button.waitForExistence(timeout: 30), "No passkey sheet. App:\n\(app.debugDescription)")
        button.tap()
    }

    // MARK: - Helpers

    private func tap(_ label: String, timeout: TimeInterval = 30, file: StaticString = #filePath, line: UInt = #line) {
        let button = app.buttons[label]
        XCTAssertTrue(button.waitForExistence(timeout: timeout), "No \"\(label)\" button\n\(app.debugDescription)", file: file, line: line)
        button.tap()
    }

    private func text(containing fragment: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", fragment)).firstMatch
    }

    private func attach(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}

extension XCUIElement {
    func clearAndType(_ text: String) {
        if let current = value as? String, !current.isEmpty {
            typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: current.count))
        }
        typeText(text)
    }
}
