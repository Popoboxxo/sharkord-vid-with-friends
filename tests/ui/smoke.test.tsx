import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Badge, Button } from "../../src/ui/kit";

describe("UI test harness smoke", () => {
  test("happy-dom + react render a UI-Kit primitive", () => {
    render(<Badge icon="🎬">Hello</Badge>);
    expect(screen.getByText("Hello")).toBeDefined();
  });

  test("button fires onClick", () => {
    let clicked = 0;
    render(<Button onClick={() => clicked++}>Go</Button>);
    screen.getByText("Go").click();
    expect(clicked).toBe(1);
  });
});
