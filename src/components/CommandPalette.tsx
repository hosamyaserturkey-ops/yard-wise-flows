import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart3, Container, Ship, FileText, Calendar, Upload, Anchor,
  Calculator, Users, Building2, ClipboardCheck, Search,
} from "lucide-react";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput,
  CommandItem, CommandList, CommandSeparator,
} from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface ContainerResult {
  container_number: string;
  status: string;
  shipping_line: string;
}

const NAV_COMMANDS = [
  { label: "Dashboard",   href: "/",             icon: BarChart3    },
  { label: "Gate In",     href: "/gate-in",       icon: Container    },
  { label: "Gate Out",    href: "/gate-out",       icon: Ship         },
  { label: "Reports",     href: "/reports",        icon: FileText     },
  { label: "Bookings",    href: "/bookings",       icon: Calendar     },
  { label: "Import",      href: "/import",         icon: Upload       },
  { label: "Port Data",   href: "/port-data",      icon: Anchor       },
  { label: "Accounting",  href: "/accounting",     icon: Calculator   },
  { label: "Users",       href: "/admin/users",    icon: Users        },
  { label: "Yards",       href: "/admin/yards",    icon: Building2    },
  { label: "Inspect",     href: "/inspector",      icon: ClipboardCheck },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContainerResult[]>([]);
  const [searching, setSearching] = useState(false);
  const navigate = useNavigate();
  const { isAdmin, isSuperAdmin, isInspector } = useAuth();

  const admin = isAdmin();
  const superAdmin = isSuperAdmin();
  const inspector = isInspector();

  // Filter nav items by role
  const navItems = NAV_COMMANDS.filter((item) => {
    if (item.href === "/port-data" || item.href === "/admin/yards") return superAdmin;
    if (["/import", "/accounting", "/admin/users"].includes(item.href)) return admin;
    if (item.href === "/inspector") return admin || superAdmin || inspector;
    return !superAdmin && !inspector; // ops pages hidden from super/inspector
  });

  // Open with ⌘K / Ctrl+K
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // Search containers
  const searchContainers = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setSearching(true);
    const { data } = await supabase
      .from("containers")
      .select("container_number, status, shipping_line")
      .ilike("container_number", `%${q}%`)
      .limit(6);
    setResults(data ?? []);
    setSearching(false);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => searchContainers(query), 250);
    return () => clearTimeout(t);
  }, [query, searchContainers]);

  const go = (href: string) => {
    navigate(href);
    setOpen(false);
    setQuery("");
  };

  const STATUS_ICON: Record<string, string> = {
    "in-yard": "🟢",
    reserved:  "🟡",
    out:       "⚫",
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search containers or navigate…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {searching ? "Searching…" : "No results found."}
        </CommandEmpty>

        {results.length > 0 && (
          <>
            <CommandGroup heading="Containers">
              {results.map((c) => (
                <CommandItem
                  key={c.container_number}
                  value={c.container_number}
                  onSelect={() => go(`/gate-in?container=${c.container_number}`)}
                >
                  <Container className="mr-2 h-4 w-4 shrink-0" />
                  <span className="font-mono font-semibold">{c.container_number}</span>
                  <span className="ml-2 text-muted-foreground text-xs">
                    {STATUS_ICON[c.status] ?? ""} {c.status} · {c.shipping_line}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />
          </>
        )}

        <CommandGroup heading="Navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem key={item.href} value={item.label} onSelect={() => go(item.href)}>
                <Icon className="mr-2 h-4 w-4 shrink-0" />
                {item.label}
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
