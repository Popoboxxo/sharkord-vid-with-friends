/**
 * UI-Kit primitives — Badge, Button, IconButton, Card, Panel, List, StatusDot.
 *
 * Plugin-agnostic: these ship vendored in every Sharkord plugin, so the suite
 * is canonicalized alongside the kit in sharkord-meta/templates/plugin-ui/.
 */

import { describe, expect, test } from "bun:test";
import { render, screen } from "@testing-library/react";
import { Badge, Button, Card, IconButton, List, Panel, StatusDot } from "../../src/ui/kit";

describe("Badge", () => {
  test("renders icon + children", () => {
    render(<Badge icon="🎬">Now Playing</Badge>);
    expect(screen.getByText("Now Playing")).toBeDefined();
    expect(screen.getByText("🎬")).toBeDefined();
  });
});

describe("Button", () => {
  test("fires onClick when enabled", () => {
    let n = 0;
    render(<Button onClick={() => n++}>Go</Button>);
    screen.getByText("Go").click();
    expect(n).toBe(1);
  });

  test("is disabled and does not fire when disabled", () => {
    let n = 0;
    render(
      <Button onClick={() => n++} disabled>
        Nope
      </Button>,
    );
    const btn = screen.getByText("Nope") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    btn.click();
    expect(n).toBe(0);
  });
});

describe("IconButton", () => {
  test("exposes its title for accessibility/tooltip", () => {
    render(<IconButton icon="⏸" title="Pause" onClick={() => {}} />);
    expect(screen.getByTitle("Pause")).toBeDefined();
  });
});

describe("Card / Panel", () => {
  test("Card renders title + children", () => {
    render(<Card title="My Card">body</Card>);
    expect(screen.getByText("My Card")).toBeDefined();
    expect(screen.getByText("body")).toBeDefined();
  });

  test("Panel renders heading", () => {
    render(<Panel title="Full Screen">x</Panel>);
    expect(screen.getByText("Full Screen")).toBeDefined();
  });
});

describe("List", () => {
  test("renders provided rows", () => {
    render(<List items={[<span key="a">A</span>, <span key="b">B</span>]} />);
    expect(screen.getByText("A")).toBeDefined();
    expect(screen.getByText("B")).toBeDefined();
  });

  test("renders the empty fallback when there are no items", () => {
    render(<List items={[]} empty="Nothing here." />);
    expect(screen.getByText("Nothing here.")).toBeDefined();
  });
});

describe("StatusDot", () => {
  test("renders without crashing", () => {
    const { container } = render(<StatusDot color="#0f0" pulse />);
    expect(container.querySelector("span")).not.toBeNull();
  });
});
