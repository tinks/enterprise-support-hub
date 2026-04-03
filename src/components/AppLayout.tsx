import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { Settings, BarChart3, GitBranch, MessageSquare, BookOpen, Import, Users } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const navItems = [
  { to: "/", icon: BarChart3, label: "Stats", end: true },
  { to: "/conversations", icon: MessageSquare, label: "Conversations" },
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
  const [expanded, setExpanded] = useState(false);
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  const isDashboardActive = dashboardItems.some((d) => location.pathname.startsWith(d.to));

  const handleMouseLeave = () => {
    setExpanded(false);
    setDashboardOpen(false);
  };

  const linkBase =
    "flex items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium transition-colors text-muted-foreground hover:text-foreground hover:bg-accent whitespace-nowrap";
  const activeClass = "bg-accent text-foreground";

  return (
    <div className="h-screen flex flex-row overflow-hidden bg-background">
      {/* Vertical gradient accent */}
      <div className="w-0.5 bg-gradient-to-b from-[#FF6B6B] via-[#E66FD2] to-[#9B87F5] shrink-0" />

      {/* Sidebar */}
      <aside
        className="shrink-0 border-r border-border bg-card flex flex-col transition-all duration-200 ease-in-out relative z-20"
        style={{ width: expanded ? 200 : 56 }}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={handleMouseLeave}
      >
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border min-h-[48px] overflow-hidden">
          <img src="/lovable-logo.png" alt="Lovable" className="h-6 w-6 shrink-0" />
          <span
            className={`text-sm font-semibold text-foreground truncate transition-all duration-200 ${
              expanded ? "opacity-100 w-auto" : "opacity-0 w-0"
            }`}
          >
            Support hub
          </span>
        </div>

        {/* Nav links */}
        <nav className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-1 flex flex-col gap-1 p-2 overflow-y-auto overflow-x-hidden">
            <TooltipProvider delayDuration={0}>
              {navItems.slice(0, 2).map((item) => (
                <Tooltip key={item.to}>
                  <TooltipTrigger asChild>
                    <NavLink to={item.to} className={linkBase} activeClassName={activeClass} end={item.end}>
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className={`transition-all duration-200 overflow-hidden ${expanded ? "opacity-100 w-auto" : "opacity-0 w-0"}`}>
                        {item.label}
                      </span>
                    </NavLink>
                  </TooltipTrigger>
                  {!expanded && <TooltipContent side="right">{item.label}</TooltipContent>}
                </Tooltip>
              ))}

              {/* Dashboards — portal-based dropdown */}
              <DropdownMenu open={dashboardOpen} onOpenChange={setDashboardOpen}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <div
                        className={`${linkBase} cursor-pointer ${isDashboardActive ? activeClass : ""}`}
                        onMouseEnter={() => { if (expanded) setDashboardOpen(true); }}
                      >
                        <Users className="h-4 w-4 shrink-0" />
                        <span className={`transition-all duration-200 overflow-hidden ${expanded ? "opacity-100 w-auto" : "opacity-0 w-0"}`}>
                          Dashboards
                        </span>
                      </div>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  {!expanded && !dashboardOpen && <TooltipContent side="right">Dashboards</TooltipContent>}
                </Tooltip>
                <DropdownMenuContent
                  side="right"
                  align="start"
                  sideOffset={4}
                  className="min-w-[140px]"
                  onMouseLeave={() => setDashboardOpen(false)}
                >
                  {dashboardItems.map((d) => (
                    <DropdownMenuItem
                      key={d.to}
                      className="cursor-pointer"
                      onClick={() => { navigate(d.to); setDashboardOpen(false); }}
                    >
                      {d.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {navItems.slice(2).map((item) => (
                <Tooltip key={item.to}>
                  <TooltipTrigger asChild>
                    <NavLink to={item.to} className={linkBase} activeClassName={activeClass} end={item.end}>
                      <item.icon className="h-4 w-4 shrink-0" />
                      <span className={`transition-all duration-200 overflow-hidden ${expanded ? "opacity-100 w-auto" : "opacity-0 w-0"}`}>
                        {item.label}
                      </span>
                    </NavLink>
                  </TooltipTrigger>
                  {!expanded && <TooltipContent side="right">{item.label}</TooltipContent>}
                </Tooltip>
              ))}
            </TooltipProvider>
          </div>
        </nav>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0 overflow-auto">
        {children}
      </div>
    </div>
  );
};

export default AppLayout;
