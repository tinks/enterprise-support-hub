import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import {
  Settings,
  BarChart3,
  GitBranch,
  MessageSquare,
  BookOpen,
  Import,
  Users,
  LogOut,
  Sparkles,
  Beaker,
  ScrollText,
  Gauge,
  Building2,
  Wrench,
  Cog,
  Bell,
  Search as SearchIcon,
  Siren,
  LucideIcon,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useCanEdit } from "@/hooks/useCanEdit";
import { useDashboardTeammates } from "@/hooks/useDashboardTeammates";
import { useActionSignals } from "@/lib/actionSignalsContext";
import IncidentBanner from "@/components/IncidentBanner";

type NavChild = { to: string; label: string; end?: boolean; adminOnly?: boolean; editorOnly?: boolean };
type NavLinkItem = { kind: "link"; to: string; icon: LucideIcon; label: string; end?: boolean };
type NavGroupItem = { kind: "group"; label: string; icon: LucideIcon; items: NavChild[] };
type NavEntry = NavLinkItem | NavGroupItem;

const navEntries: NavEntry[] = [
  { kind: "link", to: "/action-center", icon: Bell, label: "Action center" },
  {
    kind: "group",
    label: "Reports",
    icon: BarChart3,
    items: [
      { to: "/stats", label: "Analytics (legacy)" },
      { to: "/analytics-v3", label: "Analytics v3" },
      { to: "/trend-report", label: "Trend report (v3)" },
      { to: "/monthly-lookback", label: "Monthly lookback" },
      { to: "/csat-report", label: "CSAT report" },
      { to: "/resolution-anatomy", label: "Resolution anatomy" },
      { to: "/insights", label: "Insights" },
      { to: "/sla-report", label: "SLA Report" },
    ],
  },
  { kind: "link", to: "/search", icon: SearchIcon, label: "Deep search" },
  { kind: "link", to: "/incidents", icon: Siren, label: "Incidents" },
  { kind: "link", to: "/customer-report", icon: Beaker, label: "Customer report" },
  { kind: "link", to: "/my-queue", icon: Gauge, label: "My queue" },
  {
    kind: "group",
    label: "Issues",
    icon: MessageSquare,
    items: [
      { to: "/triage", label: "Triage", editorOnly: true },
      { to: "/escalations", label: "Dev escalations", editorOnly: true },
      { to: "/conversations", label: "Inbox" },
      { to: "/inbox-v3", label: "Inbox v3" },
    ],
  },
  {
    kind: "group",
    label: "Dashboards (legacy)",
    icon: Users,
    items: [],
  },
  {
    kind: "group",
    label: "Dashboards (v3)",
    icon: Users,
    items: [{ to: "/sla", label: "SLA Dashboard" }],
  },
  {
    kind: "group",
    label: "Tools",
    icon: Wrench,
    items: [
      { to: "/import", label: "Import", editorOnly: true },
      { to: "/sla-workbench", label: "SLA Workbench" },
      { to: "/backlog", label: "Backlog", editorOnly: true },
      { to: "/prospects", label: "Prospects" },
      { to: "/sla-what-if", label: "SLA What-if" },
    ],
  },
  {
    kind: "group",
    label: "Admin",
    icon: Cog,
    items: [
      { to: "/customers", label: "Customers" },
      // /users (Access + Roles) is hidden — superseded by /people. Route still works.
      { to: "/people", label: "People", adminOnly: true },

      { to: "/settings", label: "Settings" },
      { to: "/float-coverage", label: "Float coverage" },
      { to: "/sla-policy", label: "SLA Policy", adminOnly: true },
      { to: "/severity-ai", label: "Severity AI", editorOnly: true },
    ],

  },
  {
    kind: "group",
    label: "Docs",
    icon: BookOpen,
    items: [
      { to: "/knowledge", label: "Knowledge", editorOnly: true },
      { to: "/flow", label: "Flow", editorOnly: true },
      { to: "/changelog", label: "Changelog" },
    ],
  },
];

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [menuHovered, setMenuHovered] = useState(false);
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [flyoutTop, setFlyoutTop] = useState(0);
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const location = useLocation();
  const navigate = useNavigate();
  const { isAdmin } = useIsAdmin();
  const { canEdit } = useCanEdit();
  const { items: dashboardTeammates } = useDashboardTeammates();
  const { attentionCount, errorCount } = useActionSignals();
  // One aggregate disc on the rail: how many SIGNALS need attention (not items).
  const railBadge = attentionCount + errorCount;

  // Admin-only nav children are hidden for non-admins; editor-only children are
  // hidden for read-only accounts (CSMs). Routes + RLS enforce too.
  // The Dashboards group appends the per-owner entries driven by the teammates roster.
  const visibleEntries: NavEntry[] = navEntries.map((e) => {
    if (e.kind !== "group") return e;
    const items = e.items.filter(
      (i) => (!i.adminOnly || isAdmin) && (!i.editorOnly || canEdit),
    );
    if (e.label === "Dashboards (legacy)") return { ...e, items: [...items, ...dashboardTeammates] };
    // v3 mirror: same roster, pointed at the v3 reporting dashboards.
    if (e.label === "Dashboards (v3)") {
      return {
        ...e,
        items: [
          ...items,
          ...dashboardTeammates.map((t) => ({ ...t, to: t.to.replace(/^\/my\//, "/my-v3/") })),
        ],
      };
    }
    return { ...e, items };
  });

  // Sidebar stays expanded if hovering sidebar OR the portalled menu
  const expanded = sidebarHovered || menuHovered;

  useEffect(() => {
    if (expanded) setActiveTooltip(null);
  }, [expanded]);

  // Debounce so the mouse can cross from the rail row into the flyout
  useEffect(() => {
    if (hoveredGroup) {
      setOpenGroup(hoveredGroup);
      const el = rowRefs.current[hoveredGroup];
      if (el) setFlyoutTop(el.getBoundingClientRect().top);
      return;
    }
    if (menuHovered) return;
    const timer = setTimeout(() => setOpenGroup(null), 150);
    return () => clearTimeout(timer);
  }, [hoveredGroup, menuHovered]);

  const linkBase =
    "flex items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium transition-colors text-muted-foreground hover:text-foreground hover:bg-accent whitespace-nowrap overflow-hidden";
  const activeClass = "bg-accent text-foreground";

  const labelClass = `transition-all duration-200 overflow-hidden ${expanded ? "opacity-100 max-w-[150px]" : "opacity-0 max-w-0"}`;

  const isPathActive = (to: string, end?: boolean) =>
    end ? location.pathname === to : location.pathname === to || location.pathname.startsWith(to + "/");

  const openGroupEntry = visibleEntries.find(
    (e): e is NavGroupItem => e.kind === "group" && e.label === openGroup,
  );

  const renderLink = (to: string, icon: LucideIcon, label: string, end?: boolean) => {
    const Icon = icon;
    const badge = to === "/action-center" && railBadge > 0 ? railBadge : null;
    return (
      <TooltipProvider key={to} delayDuration={0}>
        <Tooltip open={!expanded && activeTooltip === label}>
          <TooltipTrigger asChild>
            <div
              onMouseEnter={() => {
                setActiveTooltip(label);
                setHoveredGroup(null);
              }}
              onMouseLeave={() => setActiveTooltip(null)}
            >
              <NavLink to={to} className={`${linkBase} relative`} activeClassName={activeClass} end={end}>
                <Icon className="h-4 w-4 shrink-0" />
                <span className={labelClass}>{label}</span>
                {badge != null && (
                  <span
                    className={
                      expanded
                        ? "ml-auto shrink-0 rounded-full bg-destructive text-destructive-foreground text-[10px] leading-none font-semibold px-1.5 py-1"
                        : "absolute left-6 top-1.5 rounded-full bg-destructive text-destructive-foreground text-[10px] leading-none font-semibold px-1.5 py-1"
                    }
                  >
                    {badge}
                  </span>
                )}
              </NavLink>
            </div>
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  return (
    <div className="h-screen flex flex-row overflow-hidden bg-background">
      {/* Vertical gradient accent */}
      <div className="w-0.5 bg-gradient-to-b from-[#FF6B6B] via-[#E66FD2] to-[#9B87F5] shrink-0" />

      {/* Sidebar */}
      <aside
        className="shrink-0 border-r border-border bg-card flex flex-col transition-all duration-200 ease-in-out relative z-20"
        style={{ width: expanded ? 200 : 56 }}
        onMouseEnter={() => setSidebarHovered(true)}
        onMouseLeave={() => {
          setSidebarHovered(false);
          setActiveTooltip(null);
          setHoveredGroup(null);
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border min-h-[48px] overflow-hidden">
          <img src="/lovable-logo.png" alt="Lovable" className="h-6 w-6 shrink-0" />
          <span className={`text-sm font-semibold text-foreground truncate ${labelClass}`}>
            Enterprise support hub
          </span>
        </div>

        {/* Nav links */}
        <nav className="flex-1 flex flex-col justify-between">
          <div className="flex-1 flex flex-col gap-1 p-2 overflow-y-auto overflow-x-hidden">
            {visibleEntries.map((entry) => {
              if (entry.kind === "link") {
                return renderLink(entry.to, entry.icon, entry.label, entry.end);
              }

              // 1-item group degrades to a plain link
              if (entry.items.length === 1) {
                const only = entry.items[0];
                return renderLink(only.to, entry.icon, only.label, only.end);
              }

              const Icon = entry.icon;
              const groupActive = entry.items.some((i) => isPathActive(i.to, i.end));

              return (
                <TooltipProvider key={entry.label} delayDuration={0}>
                  <Tooltip open={!expanded && openGroup !== entry.label && activeTooltip === entry.label}>
                    <TooltipTrigger asChild>
                      <div
                        ref={(el) => {
                          rowRefs.current[entry.label] = el;
                        }}
                        className={`${linkBase} cursor-pointer relative ${groupActive ? activeClass : ""}`}
                        onMouseEnter={() => {
                          setHoveredGroup(entry.label);
                          setActiveTooltip(entry.label);
                        }}
                        onMouseLeave={() => {
                          setHoveredGroup(null);
                          setActiveTooltip(null);
                        }}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className={labelClass}>{entry.label}</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right">{entry.label}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })}
          </div>
          <div className="p-2 border-t border-border">
            <button
              onClick={() => supabase.auth.signOut().then(() => navigate("/login"))}
              className={`${linkBase} w-full`}
            >
              <LogOut className="h-4 w-4 shrink-0" />
              <span className={labelClass}>Sign out</span>
            </button>
          </div>
        </nav>
      </aside>

      {/* Generic group flyout — rendered outside the sidebar entirely */}
      {openGroupEntry && (
        <NavFlyout
          items={openGroupEntry.items}
          top={flyoutTop}
          sidebarWidth={expanded ? 200 : 56}
          isActive={isPathActive}
          onMouseEnter={() => setMenuHovered(true)}
          onMouseLeave={() => {
            setMenuHovered(false);
            setOpenGroup(null);
          }}
          onNavigate={(to) => {
            navigate(to);
            setMenuHovered(false);
            setHoveredGroup(null);
            setOpenGroup(null);
          }}
        />
      )}

      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-auto">
        <IncidentBanner />
        {children}
      </div>

    </div>
  );
};

/** Flyout menu positioned next to the hovered group row, rendered at the top level */
function NavFlyout({
  items,
  top,
  sidebarWidth,
  isActive,
  onMouseEnter,
  onMouseLeave,
  onNavigate,
}: {
  items: NavChild[];
  top: number;
  sidebarWidth: number;
  isActive: (to: string, end?: boolean) => boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onNavigate: (to: string) => void;
}) {
  return (
    <div
      className="fixed z-50"
      style={{ left: sidebarWidth, top }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="bg-popover border border-border rounded-md shadow-md p-1 min-w-[160px]">
        {items.map((d) => (
          <div
            key={d.to}
            className={`px-3 py-2 text-sm rounded-sm cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors ${
              isActive(d.to, d.end) ? "bg-accent text-accent-foreground" : ""
            }`}
            onClick={() => onNavigate(d.to)}
          >
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}

export default AppLayout;
