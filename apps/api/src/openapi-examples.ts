interface SchemaWithMeta {
  operationId?: string;
  body?: Record<string, unknown>;
  response?: Record<string, Record<string, unknown>>;
}

const paymentExample = {
  object: "payment",
  id: "pay_2f8c1a9d4e6b7c8d9e0f1a2b3c4d5e6f",
  status: "succeeded",
  amount_minor: 24900,
  amount: "249.00",
  currency: "INR",
  customer_id: "cus_demo_101",
  description: "Order #1042",
  payment_method_id: "pm_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
  failure_code: null,
  refunded_minor: 0,
  refund_reserved_minor: 0,
  refundable_minor: 24900,
  created_at: "2026-10-21T09:00:00.000Z",
  updated_at: "2026-10-21T09:00:01.482Z",
};

const EXAMPLES: Record<
  string,
  { request?: unknown; response?: Record<string, unknown> }
> = {
  createPayment: {
    request: {
      amount_minor: 24900,
      currency: "INR",
      customer_id: "cus_demo_101",
      description: "Order #1042",
      payment_method_id: "pm_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
      simulator_scenario: "approve",
    },
    response: {
      "202": {
        ...paymentExample,
        status: "created",
        created_at: "2026-10-21T09:00:00.000Z",
        updated_at: "2026-10-21T09:00:00.000Z",
      },
    },
  },
  getPayment: {
    response: {
      "200": {
        ...paymentExample,
        attempts: [
          {
            id: "att_7c6b5a493827160f5e4d3c2b1a09f8e7d",
            attempt_number: 1,
            status: "succeeded",
            processor_reference: "proc_36ca88bc138082283c86b2cf",
            failure_code: null,
            started_at: "2026-10-21T09:00:00.120Z",
            finished_at: "2026-10-21T09:00:01.482Z",
          },
        ],
        events: [
          {
            id: "evt_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
            type: "payment.created",
            from_status: null,
            to_status: "created",
            reason: null,
            created_at: "2026-10-21T09:00:00.000Z",
          },
          {
            id: "evt_2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e",
            type: "payment.succeeded",
            from_status: "processing",
            to_status: "succeeded",
            reason: "Processor approved the charge.",
            created_at: "2026-10-21T09:00:01.482Z",
          },
        ],
      },
    },
  },
  listPayments: {
    response: {
      "200": {
        data: [paymentExample],
        has_more: true,
        next_cursor: "MjAyNi0xMC0yMVQwOTowMDowMC4wMDBafHBheV8y",
      },
    },
  },
  createRefund: {
    request: {
      payment_id: "pay_2f8c1a9d4e6b7c8d9e0f1a2b3c4d5e6f",
      amount_minor: 5000,
      reason: "damaged item",
      simulator_scenario: "approve",
    },
    response: {
      "202": {
        object: "refund",
        id: "ref_9f8e7d6c5b4a39281706f5e4d3c2b1a09",
        payment_id: "pay_2f8c1a9d4e6b7c8d9e0f1a2b3c4d5e6f",
        status: "reserved",
        amount_minor: 5000,
        amount: "50.00",
        currency: "INR",
        reason: "damaged item",
        failure_code: null,
        created_at: "2026-10-21T09:05:00.000Z",
        updated_at: "2026-10-21T09:05:00.000Z",
      },
    },
  },
  createPaymentMethod: {
    request: {
      type: "card",
      label: "Acme corporate card",
      last4: "4242",
      network: "visa",
      expiry_month: 11,
      expiry_year: 2030,
    },
    response: {
      "201": {
        object: "payment_method",
        id: "pm_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
        type: "card",
        label: "Acme corporate card",
        last4: "4242",
        network: "visa",
        expiry_month: 11,
        expiry_year: 2030,
        status: "active",
        created_at: "2026-10-21T08:30:00.000Z",
      },
    },
  },
  createPayout: {
    request: {
      amount_minor: 5000,
      destination: "bank://hdfc-7788",
      simulator_scenario: "approve",
    },
    response: {
      "202": {
        object: "payout",
        id: "po_5e4d3c2b1a09f8e7d6c5b4a39281706f5",
        status: "pending",
        amount_minor: 5000,
        amount: "50.00",
        currency: "INR",
        destination: "bank://hdfc-7788",
        failure_code: null,
        created_at: "2026-10-21T09:10:00.000Z",
        updated_at: "2026-10-21T09:10:00.000Z",
      },
    },
  },
  createDispute: {
    request: {
      payment_id: "pay_2f8c1a9d4e6b7c8d9e0f1a2b3c4d5e6f",
      amount_minor: 2000,
      reason: "Customer claims the order never arrived",
      note: "Awaiting carrier evidence",
    },
    response: {
      "201": {
        object: "dispute",
        id: "dp_0f9e8d7c6b5a493827160f5e4d3c2b1a",
        payment_id: "pay_2f8c1a9d4e6b7c8d9e0f1a2b3c4d5e6f",
        status: "open",
        amount_minor: 2000,
        amount: "20.00",
        reason: "Customer claims the order never arrived",
        note: "Awaiting carrier evidence",
        created_at: "2026-10-21T09:20:00.000Z",
        resolved_at: null,
      },
    },
  },
  resolveDispute: {
    request: { outcome: "lost", note: "Carrier confirmed delivery." },
    response: {
      "200": {
        object: "dispute",
        id: "dp_0f9e8d7c6b5a493827160f5e4d3c2b1a",
        payment_id: "pay_2f8c1a9d4e6b7c8d9e0f1a2b3c4d5e6f",
        status: "lost",
        amount_minor: 2000,
        amount: "20.00",
        reason: "Customer claims the order never arrived",
        note: "Carrier confirmed delivery.",
        created_at: "2026-10-21T09:20:00.000Z",
        resolved_at: "2026-10-21T09:25:00.000Z",
      },
    },
  },
  createWebhookEndpoint: {
    request: {
      url: "https://merchant.example/hooks/payflow",
      description: "Production order events",
    },
    response: {
      "201": {
        object: "webhook_endpoint",
        id: "whe_3c2b1a09f8e7d6c5b4a39281706f5e4d3c",
        url: "https://merchant.example/hooks/payflow",
        description: "Production order events",
        status: "active",
        created_at: "2026-10-21T09:30:00.000Z",
        secret: "whsec_1nR9bQ2vX8sK4mZ6pL0dT3wY5uH7jF1aB9cE5g",
      },
    },
  },
  createApiKey: {
    request: { name: "Reporting integration" },
    response: {
      "201": {
        object: "api_key",
        id: "key_4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c",
        prefix: "sk_test_8onFZnLK",
        name: "Reporting integration",
        created_at: "2026-10-21T09:40:00.000Z",
        revoked_at: null,
        last_used_at: null,
        status: "active",
        secret: "sk_test_8onFZnLK2O1Z5IUOk4yIIOvBYOPSdMI2",
      },
    },
  },
  listWebhookEvents: {
    response: {
      "200": {
        data: [
          {
            object: "webhook_event",
            id: "evt_5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c",
            type: "payment.succeeded",
            status: "delivered",
            attempts: 1,
            last_error: null,
            payload: {
              id: "evt_5e4d3c2b1a09f8e7d6c5b4a39281706f5e4d3c",
              type: "payment.succeeded",
              created_at: "2026-10-21T09:00:01.482Z",
              data: {
                id: "pay_2f8c1a…",
                amount_minor: 24900,
                status: "succeeded",
              },
            },
            created_at: "2026-10-21T09:00:01.482Z",
            updated_at: "2026-10-21T09:00:01.610Z",
          },
        ],
        has_more: false,
        next_cursor: null,
      },
    },
  },
  getOverview: {
    response: {
      "200": {
        merchant: {
          id: "mer_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
          name: "Acme Store",
        },
        payments: {
          total: 52,
          succeeded: 45,
          failed: 7,
          processing: 0,
          by_status: { succeeded: 45, failed: 7 },
          success_rate: 0.8653846153846153,
        },
        volume: {
          gross_minor: 921300,
          refunded_minor: 144600,
          net_minor: 776700,
        },
        refunds: {
          total: 14,
          succeeded: 11,
          by_status: { succeeded: 11, failed: 3 },
        },
        ledger: {
          balanced: true,
          debits_minor: 773200,
          credits_minor: 773200,
          accounts: [
            {
              id: "acct_1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
              code: "merchant_payable",
              name: "Merchant payable",
              kind: "liability",
              currency: "INR",
              debits_minor: 145600,
              credits_minor: 909300,
              balance_minor: 763700,
            },
            {
              id: "acct_2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e",
              code: "processor_clearing",
              name: "Processor clearing",
              kind: "asset",
              currency: "INR",
              debits_minor: 909300,
              credits_minor: 145600,
              balance_minor: 763700,
            },
          ],
        },
        jobs: { succeeded: 51, pending: 1 },
        recent_payments: [paymentExample],
      },
    },
  },
};

export function applyOpenApiExamples<T>(schema: T): T {
  const route = schema as unknown as SchemaWithMeta;
  const examples = EXAMPLES[route.operationId ?? ""];
  if (!examples) return schema;

  if (examples.request && route.body) {
    route.body.examples = [examples.request];
  }

  if (examples.response && route.response) {
    for (const [code, example] of Object.entries(examples.response)) {
      const response = route.response[code];
      if (!response) continue;
      response.examples = [example];
    }
  }

  return schema;
}
