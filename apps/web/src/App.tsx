import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell, Logo } from "./components/layout";
import { Spinner } from "./components/ui";
import { AuthProvider, useAuth } from "./lib/auth";
import { GuidePage } from "./pages/guide";
import { LedgerPage } from "./pages/ledger";
import { LoginPage } from "./pages/login";
import { OverviewPage } from "./pages/overview";
import { PaymentsPage } from "./pages/payments";
import { PlaygroundPage } from "./pages/playground";
import { RefundsPage } from "./pages/refunds";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 2000,
      refetchOnWindowFocus: false,
    },
  },
});

function Splash() {
  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center gap-5 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-40 [mask-image:radial-gradient(circle_at_center,black,transparent_70%)]" />
      <Logo />
      <div className="flex items-center gap-3">
        <Spinner className="size-4 text-primary" />
        <span className="display-soft text-[13px] italic text-muted-foreground">
          Opening the atelier…
        </span>
      </div>
    </div>
  );
}

function Console() {
  const { merchant, loading } = useAuth();

  if (loading) return <Splash />;
  if (!merchant) return <LoginPage />;

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="refunds" element={<RefundsPage />} />
          <Route path="ledger" element={<LedgerPage />} />
          <Route path="playground" element={<PlaygroundPage />} />
          <Route path="guide" element={<GuidePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Console />
      </AuthProvider>
    </QueryClientProvider>
  );
}
