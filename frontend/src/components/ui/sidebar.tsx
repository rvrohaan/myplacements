import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { motion } from "framer-motion";
import {
  BarChart3,
  BookOpen,
  BrainCircuit,
  Building2,
  Contact,
  CalendarDays,
  ChevronsUpDown,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  MessagesSquare,
  School,
  UserCog,
  Users,
  ClipboardCheck,
  Newspaper,
  Radar,
  SlidersHorizontal,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Link, useLocation } from "react-router-dom";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { useAuthStore } from "@/store/authStore";
import { isAdminHost } from "@/lib/tenant";
import type { UserRole } from "@/types";

const sidebarVariants = {
  open: {
    width: "15rem",
  },
  closed: {
    width: "3.05rem",
  },
};

const contentVariants = {
  open: { display: "block", opacity: 1 },
  closed: { display: "block", opacity: 1 },
};

const variants = {
  open: {
    x: 0,
    opacity: 1,
    transition: {
      x: { stiffness: 1000, velocity: -100 },
    },
  },
  closed: {
    x: -20,
    opacity: 0,
    transition: {
      x: { stiffness: 100 },
    },
  },
};

const transitionProps = {
  type: "tween",
  ease: "easeOut",
  duration: 0.2,
  staggerChildren: 0.1,
} as const;

const staggerVariants = {
  open: {
    transition: { staggerChildren: 0.03, delayChildren: 0.02 },
  },
};

const ADMIN_ROLES: UserRole[] = ["super_admin", "principal", "pro_chancellor", "deputy_pro_chancellor"];

const navItems = [
  // consoleOnly items appear only on the platform console (admin.*).
  { to: "/colleges", icon: School, label: "Colleges", consoleOnly: true },
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/companies", icon: Building2, label: "Companies" },
  { to: "/hr-contacts", icon: Contact, label: "HR Contacts" },
  { to: "/students", icon: GraduationCap, label: "Students" },
  { to: "/drives", icon: CalendarDays, label: "Drives" },
  { to: "/officers", icon: UserCog, label: "Officers" },
  { to: "/communications", icon: MessagesSquare, label: "Communications" },
  // filerOnly: the people who owe a daily update. leadershipOnly: who reads them.
  { to: "/daily-update", icon: ClipboardCheck, label: "Daily Update", filerOnly: true },
  { to: "/daily-digest", icon: Newspaper, label: "Daily Digest", leadershipOnly: true },
  { to: "/opportunities", icon: Radar, label: "Opportunities" },
  { to: "/training", icon: BookOpen, label: "Training" },
  { to: "/analytics", icon: BarChart3, label: "Analytics" },
  { to: "/people", icon: Users, label: "People", adminOnly: true },
  // Platform-wide switches: the console, and only for the platform owner.
  { to: "/platform", icon: SlidersHorizontal, label: "Platform", consoleOnly: true, superAdminOnly: true },
];

function initials(name?: string) {
  if (!name) return "U";
  return name
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function SessionNavBar() {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname } = useLocation();
  const { user, logout } = useAuthStore();
  const isAdmin = !!user && ADMIN_ROLES.includes(user.role);
  const isSuperAdmin = user?.role === "super_admin";
  const isOfficer = user?.role === "placement_officer";
  const isFiler = isOfficer || user?.role === "department_coordinator";
  const adminHost = isAdminHost();
  // The platform console shows only its console tools (Colleges, People); college
  // portals show the data tabs and hide console-only items.
  const visibleNavItems = navItems.filter((item) => {
    if (item.superAdminOnly && !isSuperAdmin) return false;
    if (item.consoleOnly) return adminHost;
    if (adminHost) return item.to === "/people";
    if (item.filerOnly) return isFiler;
    if (item.leadershipOnly) return isAdmin;
    return !item.adminOnly || isAdmin;
  });

  return (
    <motion.div
      className={cn("sidebar fixed left-0 z-40 h-full shrink-0 border-r")}
      initial={isCollapsed ? "closed" : "open"}
      animate={isCollapsed ? "closed" : "open"}
      variants={sidebarVariants}
      transition={transitionProps}
      onMouseEnter={() => setIsCollapsed(false)}
      onMouseLeave={() => {
        setIsCollapsed(true);
        setMenuOpen(false);
      }}
    >
      <motion.div
        className={`relative z-40 flex text-white h-full shrink-0 flex-col bg-primary-900 transition-all`}
        variants={contentVariants}
      >
        <motion.ul variants={staggerVariants} className="flex h-full flex-col">
          <div className="flex grow flex-col items-center">
            <div className="flex h-[54px] w-full shrink-0 items-center border-b p-2">
              <div className="flex w-full items-center gap-2 px-2">
                <BrainCircuit className="h-5 w-5 shrink-0 text-sky-400" />
                <motion.li
                  variants={variants}
                  className="flex w-fit items-center gap-2"
                >
                  {!isCollapsed && (
                    <p className="text-sm font-semibold text-white">
                      MyPlacement.AI
                    </p>
                  )}
                </motion.li>
              </div>
            </div>

            <div className="flex h-full w-full flex-col">
              <div className="flex grow flex-col gap-4">
                <ScrollArea className="h-16 grow p-2">
                  <div className={cn("flex w-full flex-col gap-1")}>
                    {visibleNavItems.map(({ to, icon: Icon, label }) => {
                      // Officers don't manage the team — the page is their own
                      // allocation, so label it that way for them.
                      const displayLabel =
                        to === "/officers" && isOfficer ? "My Allocation" : label;
                      const isActive = pathname.startsWith(to);
                      return (
                        <Link
                          key={to}
                          to={to}
                          className={cn(
                            "relative flex h-8 w-full flex-row items-center rounded-md px-2 py-1.5 text-primary-100 transition hover:bg-primary-800 hover:text-white",
                            isActive && "bg-white/10 text-white",
                          )}
                        >
                          {isActive && (
                            <span aria-hidden className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-1 rounded-r-full bg-gradient-to-b from-sky-400 to-cyan-400">
                              <span className="absolute -left-1 -top-1 h-6 w-3 rounded-full bg-sky-400/40 blur-md" />
                            </span>
                          )}
                          <Icon className={cn("h-4 w-4 shrink-0", isActive && "text-sky-300")} />
                          <motion.li variants={variants}>
                            {!isCollapsed && (
                              <p className="ml-2 text-sm font-medium text-white">{displayLabel}</p>
                            )}
                          </motion.li>
                        </Link>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
              <div className="flex flex-col p-2">
                <Separator className="mb-2 w-full" />
                <div>
                  <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
                    <DropdownMenuTrigger
                      className="w-full"
                      aria-label={`Account: ${user?.full_name ?? "signed in"}`}
                    >
                      <div className="flex h-8 w-full flex-row items-center gap-2 rounded-md px-2 py-1.5 transition hover:bg-primary-800 cursor-pointer">
                        {/* Deliberately larger than the 4x4 nav icons: this is
                            the account, not another destination, and it is the
                            only avatar in the app now that the header has none. */}
                        <Avatar className="size-6 shrink-0 shadow-sm shadow-sky-500/30">
                          <AvatarFallback className="bg-gradient-to-br from-blue-500 to-cyan-500 text-[10px] font-semibold text-white">
                            {initials(user?.full_name)}
                          </AvatarFallback>
                        </Avatar>
                        <motion.li
                          variants={variants}
                          className="flex w-full items-center gap-2"
                        >
                          {!isCollapsed && (
                            <>
                              <p className="text-sm font-medium text-white">Account</p>
                              <ChevronsUpDown className="ml-auto h-4 w-4 text-muted-foreground/50" />
                            </>
                          )}
                        </motion.li>
                      </div>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      sideOffset={5}
                      className="border-primary-700 bg-primary-900 text-white"
                    >
                      <div className="flex flex-row items-center gap-2 p-2">
                        <Avatar className="size-8 shrink-0">
                          <AvatarFallback className="bg-gradient-to-br from-blue-500 to-cyan-500 text-xs font-semibold text-white">
                            {initials(user?.full_name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col text-left">
                          <span className="text-sm font-medium text-white">
                            {user?.full_name ?? "User"}
                          </span>
                          <span className="line-clamp-1 text-xs capitalize text-primary-300">
                            {user?.role?.replace(/_/g, " ")}
                          </span>
                          {user?.email && (
                            <span className="line-clamp-1 text-xs text-primary-300">
                              {user.email}
                            </span>
                          )}
                        </div>
                      </div>
                      <DropdownMenuSeparator className="bg-primary-700" />
                      <DropdownMenuItem
                        onClick={logout}
                        className="flex items-center gap-2 cursor-pointer text-white focus:bg-primary-800 focus:text-white"
                      >
                        <LogOut className="h-4 w-4" /> Sign out
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </div>
          </div>
        </motion.ul>
      </motion.div>
    </motion.div>
  );
}
