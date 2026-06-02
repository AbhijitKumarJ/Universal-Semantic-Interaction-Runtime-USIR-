import type { CheckoutSession, PaymentMethod, PaymentProviderConfig } from '@usir/protocol/capability';

export interface PaymentResult {
  success: boolean;
  transactionId?: string;
  error?: string;
}

export interface PaymentProvider {
  createCheckout(session: Omit<CheckoutSession, 'id' | 'createdAt' | 'status'>): Promise<CheckoutSession>;
  processPayment(invoiceId: string, amount: number, currency: string, paymentMethodId: string): Promise<PaymentResult>;
  refundPayment(transactionId: string, amount?: number): Promise<PaymentResult>;
  getPaymentMethods(consumerId: string): Promise<PaymentMethod[]>;
}

export class MockPaymentProvider implements PaymentProvider {
  private config: PaymentProviderConfig;
  private transactions = new Map<string, string>();

  constructor(config?: Partial<PaymentProviderConfig>) {
    this.config = {
      provider: 'mock',
      ...config,
    };
  }

  async createCheckout(session: Omit<CheckoutSession, 'id' | 'createdAt' | 'status'>): Promise<CheckoutSession> {
    return {
      id: `cs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      invoiceId: session.invoiceId,
      amount: session.amount,
      currency: session.currency,
      status: 'pending',
      createdAt: Date.now(),
    };
  }

  async processPayment(invoiceId: string, amount: number, currency: string, _paymentMethodId: string): Promise<PaymentResult> {
    const transactionId = `txn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.transactions.set(invoiceId, transactionId);
    return { success: true, transactionId };
  }

  async refundPayment(transactionId: string, _amount?: number): Promise<PaymentResult> {
    return { success: true, transactionId: `ref_${transactionId}` };
  }

  async getPaymentMethods(_consumerId: string): Promise<PaymentMethod[]> {
    return [
      {
        id: 'pm_mock_default',
        type: 'card',
        last4: '4242',
        expiryMonth: 12,
        expiryYear: 2030,
        isDefault: true,
      },
    ];
  }
}
