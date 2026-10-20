import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, ButtonLink, buttonClassName, type ButtonVariant } from "../../src/ui/components/lsm/Button";

test("button recipes preserve variants, caller classes and native button/link semantics", () => {
  for (const variant of ["primary", "secondary", "secondary-quiet", "destructive", "editorial"] as ButtonVariant[]) {
    assert.equal(buttonClassName(variant, "caller"), `ca-button ca-button-${variant} caller`);
    const button = renderToStaticMarkup(React.createElement(Button, { variant, disabled: true, "aria-label": "Fixture action", type: "button" }, "Action"));
    assert.match(button, /^<button /);
    assert.ok(button.includes(`ca-button-${variant}`));
    assert.match(button, /disabled=""/);
    assert.match(button, /aria-label="Fixture action"/);
    const link = renderToStaticMarkup(React.createElement(ButtonLink, { variant, href: "#fixture", className: "caller" }, "Destination"));
    assert.match(link, /^<a /);
    assert.match(link, /href="#fixture"/);
    assert.ok(link.includes(`ca-button-${variant} caller`));
  }
  assert.equal(buttonClassName(), "ca-button ca-button-primary");
});
