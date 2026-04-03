import { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { Settings, BarChart3, GitBranch, MessageSquare, BookOpen, Import, Users } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const navItems = [
  { to: "/", icon: BarChart3, label: "Stats", end: true },
  { to: "/conversations", icon: MessageSquare, label: "Inbox" },
  { to: "/import", icon: Import, label: "Import" },
  { to: "/settings", icon: Settings, label: "Settings" },
  { to: "/flow", icon: GitBranch, label: "Flow" },
  { to: "/knowledge", icon: BookOpen, label: "Knowledge" },
];

const dashboardItems = [
  { to: "/my/joel", label: "Joel" },
  { to: "/my/kristina", label: "Kristina" },
];

const AppLayout = ({ children }: { children: React.ReactNode }) => {
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [dashboardHovered, setDashboardHovered] = useState(false);
  const [menuHovered, setMenuHovered] = useState(false);
  const [dashboardVisible, setDashboardVisible] = useState(false);
  const [activeTooltip, setActiveTooltip] = useState<string | null>(null);
  const location = useLocation();
  const navigate = useNavigate();

  // Sidebar stays expanded if hovering sidebar OR the portalled menu
  const expanded = sidebarHovered || menuHovered;

  // Clear tooltip when sidebar expands
  useEffect(() => {
    if (expanded) {
      setActiveTooltip(null);
    }
  }, [expanded]);

  // Debounce the dashboard flyout visibility so it stays mounted
  // long enough for the mouse to cross from trigger to menu
  useEffect(() => {
    if (dashboardHovered || menuHovered) {
      setDashboardVisible(true);
    } else {
      const timer = setTimeout(() => setDashboardVisible(false), 150);
      return () => clearTimeout(timer);
    }
  }, [dashboardHovered, menuHovered]);

  const isDashboardActive = dashboardItems.some((d) => location.pathname.startsWith(d.to));

  const linkBase =
    "flex items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium transition-colors text-muted-foreground hover:text-foreground hover:bg-accent whitespace-nowrap overflow-hidden";
  const activeClass = "bg-accent text-foreground";

  const labelClass = `transition-all duration-200 overflow-hidden ${expanded ? "opacity-100 max-w-[150px]" : "opacity-0 max-w-0"}`;

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
        <nav className="flex-1 flex flex-col">
          <div className="flex-1 flex flex-col gap-1 p-2 overflow-y-auto overflow-x-hidden">
              {navItems.slice(0, 2).map((item) => (
                <TooltipProvider key={item.to} delayDuration={0}>
                  <Tooltip open={!expanded && activeTooltip === item.label}>
                    <TooltipTrigger asChild>
                      <div
                        onMouseEnter={() => setActiveTooltip(item.label)}
                        onMouseLeave={() => setActiveTooltip(null)}
                      >
                        <NavLink to={item.to} className={linkBase} activeClassName={activeClass} end={item.end}>
                          <item.icon className="h-4 w-4 shrink-0" />
                          <span className={labelClass}>{item.label}</span>
                        </NavLink>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}

              {/* Dashboards — hover-driven with separate menu tracking */}
              <TooltipProvider delayDuration={0}>
                <Tooltip open={!expanded && !dashboardVisible && activeTooltip === "Dashboards"}>
                  <TooltipTrigger asChild>
                    <div
                      className={`${linkBase} cursor-pointer relative ${isDashboardActive ? activeClass : ""}`}
                      onMouseEnter={() => {
                        setDashboardHovered(true);
                        setActiveTooltip("Dashboards");
                      }}
                      onMouseLeave={() => {
                        setDashboardHovered(false);
                        setActiveTooltip(null);
                      }}
                    >
                      <Users className="h-4 w-4 shrink-0" />
                      <span className={labelClass}>Dashboards</span>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="right">Dashboards</TooltipContent>
                </Tooltip>
              </TooltipProvider>

              {navItems.slice(2).map((item) => (
                <TooltipProvider key={item.to} delayDuration={0}>
                  <Tooltip open={!expanded && activeTooltip === item.label}>
                    <TooltipTrigger asChild>
                      <div
                        onMouseEnter={() => setActiveTooltip(item.label)}
                        onMouseLeave={() => setActiveTooltip(null)}
                      >
                        <NavLink to={item.to} className={linkBase} activeClassName={activeClass} end={item.end}>
                          <item.icon className="h-4 w-4 shrink-0" />
                          <span className={labelClass}>{item.label}</span>
                        </NavLink>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right">{item.label}</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ))}
          </div>
        </nav>
      </aside>

      {/* Dashboards flyout — rendered outside the sidebar entirely */}
      {dashboardVisible && (
        <DashboardFlyout
          items={dashboardItems}
          onMouseEnter={() => setMenuHovered(true)}
          onMouseLeave={() => setMenuHovered(false)}
          onNavigate={(to) => {
            navigate(to);
            setMenuHovered(false);
            setDashboardHovered(false);
          }}
          sidebarWidth={expanded ? 200 : 56}
        />
      )}

      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-auto">
        {children}
      </div>
    </div>
  );
};

/** Flyout menu positioned next to the Dashboards row, rendered at the top level */
function DashboardFlyout({
  items,
  onMouseEnter,
  onMouseLeave,
  onNavigate,
  sidebarWidth,
}: {
  items: { to: string; label: string }[];
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onNavigate: (to: string) => void;
  sidebarWidth: number;
}) {
  // Position flush against the sidebar edge (no gap) so the mouse can cross seamlessly
  const topOffset = 49 + 8 + 40 * 2 + 4 * 2;

  return (
    <div
      className="fixed z-50"
      style={{ left: sidebarWidth, top: topOffset }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="bg-popover border border-border rounded-md shadow-md p-1 min-w-[140px]">
        {items.map((d) => (
          <div
            key={d.to}
            className="px-3 py-2 text-sm rounded-sm cursor-pointer hover:bg-accent hover:text-accent-foreground transition-colors"
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
