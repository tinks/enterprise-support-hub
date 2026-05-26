import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route, Link } from "react-router-dom";

import { supabase, supabaseFixture } from "@/test/mocks/supabase";

vi.mock("@/integrations/supabase/client", () => ({ supabase }));

// Import lazily so the mock is registered first.
import OwnerDashboard from "@/pages/OwnerDashboard";

function makeSlackRow(opts: {
  id: string;
  owner: string | null;
  message: string;
  status?: string;
}) {
  return {
    id: opts.id,
    slack_channel_id: "C123",
    slack_thread_ts: opts.id,
    slack_user_id: "U1",
    intercom_conversation_id: "",
    intercom_ticket_id: null,
    status: opts.status ?? "active",
    created_at: new Date("2026-05-01T10:00:00Z").toISOString(),
    resolved_at: opts.status === "resolved" ? new Date().toISOString() : null,
    is_test: false,
    original_message_text: opts.message,
    product_area: null,
    is_bug: false,
    is_feature_request: false,
    owner: opts.owner,
    classification: null,
    slack_user_name: "Tester",
  };
}

function Harness() {
  return (
    <MemoryRouter initialEntries={["/my/joel"]}>
      <nav>
        <Link to="/my/joel">go-joel</Link>
        <Link to="/my/kristina">go-kristina</Link>
        <Link to="/my/sam">go-sam</Link>
      </nav>
      <Routes>
        <Route path="/my/:owner" element={<OwnerDashboard />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("OwnerDashboard switching", () => {
  beforeEach(() => {
    supabaseFixture.tables.conversation_mappings = [
      makeSlackRow({ id: "j1", owner: "Joel", message: "joel-active-msg-001" }),
      makeSlackRow({ id: "j2", owner: "Joel", message: "joel-active-msg-002" }),
      makeSlackRow({ id: "k1", owner: "Kristina", message: "kristina-active-msg-001" }),
      makeSlackRow({
        id: "k2",
        owner: "Kristina",
        message: "kristina-resolved-msg-001",
        status: "resolved",
      }),
      makeSlackRow({ id: "s1", owner: "Sam", message: "sam-active-msg-001" }),
      makeSlackRow({ id: "u1", owner: null, message: "unassigned-msg-001" }),
    ];
    supabaseFixture.tables.gmail_conversations = [];
    supabaseFixture.tables.manual_conversations = [];
  });

  it("rebuilds the table for each /my/<owner> route the user navigates to", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    // --- /my/joel ---------------------------------------------------------
    await waitFor(() => {
      expect(screen.getByText("joel-active-msg-001")).toBeInTheDocument();
    });
    expect(screen.getByText("joel-active-msg-002")).toBeInTheDocument();
    expect(screen.queryByText("kristina-active-msg-001")).not.toBeInTheDocument();
    expect(screen.queryByText("sam-active-msg-001")).not.toBeInTheDocument();
    expect(screen.queryByText("unassigned-msg-001")).not.toBeInTheDocument();
    // Owner badge in filter bar.
    expect(screen.getByText(/Owner:\s*Joel/)).toBeInTheDocument();

    // --- /my/kristina -----------------------------------------------------
    await user.click(screen.getByRole("link", { name: "go-kristina" }));

    await waitFor(() => {
      expect(screen.getByText("kristina-active-msg-001")).toBeInTheDocument();
    });
    expect(screen.queryByText("joel-active-msg-001")).not.toBeInTheDocument();
    expect(screen.queryByText("joel-active-msg-002")).not.toBeInTheDocument();
    expect(screen.queryByText("sam-active-msg-001")).not.toBeInTheDocument();
    // Resolved Kristina row is hidden by the dashboard default (DASHBOARD_HIDDEN).
    expect(screen.queryByText("kristina-resolved-msg-001")).not.toBeInTheDocument();
    expect(screen.getByText(/Owner:\s*Kristina/)).toBeInTheDocument();

    // --- /my/sam ----------------------------------------------------------
    await user.click(screen.getByRole("link", { name: "go-sam" }));

    await waitFor(() => {
      expect(screen.getByText("sam-active-msg-001")).toBeInTheDocument();
    });
    expect(screen.queryByText("kristina-active-msg-001")).not.toBeInTheDocument();
    expect(screen.queryByText("joel-active-msg-001")).not.toBeInTheDocument();
    expect(screen.getByText(/Owner:\s*Sam/)).toBeInTheDocument();

    // --- back to /my/joel -------------------------------------------------
    await user.click(screen.getByRole("link", { name: "go-joel" }));

    await waitFor(() => {
      expect(screen.getByText("joel-active-msg-001")).toBeInTheDocument();
    });
    expect(screen.queryByText("sam-active-msg-001")).not.toBeInTheDocument();
    expect(screen.getByText(/Owner:\s*Joel/)).toBeInTheDocument();
  });
});

// Silence unused-import warnings for `within` (kept available for future
// row-scoped assertions).
void within;
