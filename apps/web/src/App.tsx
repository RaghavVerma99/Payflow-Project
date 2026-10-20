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
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-background">
      <Logo />
      <Spinner className="size-4 text-muted-foreground" />
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
