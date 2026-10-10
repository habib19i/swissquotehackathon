import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_CONTACTS } from "@sqw/shared";
import { familyWallet } from "./demo-bank";

test("the demo family's addresses belong to keys the demo account holds, so their coins can come back", () => {
  for (const contact of DEMO_CONTACTS) {
    assert.equal(familyWallet(contact.id).address, contact.btcAddress, contact.name);
  }
});
