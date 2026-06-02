export type PricingModel = 'free' | 'per-call' | 'subscription' | 'metered';

export type SubscriptionInterval = 'monthly' | 'yearly';

export interface RateTier {
  fromUnits: number;
  toUnits: number | null;
  costPerUnit: number;
}

export interface RateCard {
  capabilityId: string;
  model: PricingModel;
  currency: string;
  perCallCost?: number;
  subscriptionCost?: number;
  subscriptionInterval?: SubscriptionInterval;
  tiers?: RateTier[];
  meteredUnit?: string;
}

export interface UsageRecord {
  id: string;
  capabilityId: string;
  publisherId: string;
  consumerId: string;
  quantity: number;
  timestamp: number;
}

export interface UsageAggregate {
  capabilityId: string;
  publisherId: string;
  totalQuantity: number;
  recordCount: number;
  periodStart: number;
  periodEnd: number;
}

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitCost: number;
  total: number;
}

export interface Invoice {
  id: string;
  publisherId: string;
  consumerId: string;
  periodStart: number;
  periodEnd: number;
  lines: InvoiceLine[];
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  status: InvoiceStatus;
  issuedAt: number;
  paidAt?: number;
}

export interface Payout {
  id: string;
  publisherId: string;
  amount: number;
  currency: string;
  periodStart: number;
  periodEnd: number;
  invoiceCount: number;
  status: 'pending' | 'scheduled' | 'paid' | 'failed';
  scheduledAt?: number;
  paidAt?: number;
}

export interface PaymentProviderConfig {
  provider: 'stripe' | 'paypal' | 'mock';
  apiKey?: string;
  webhookSecret?: string;
}

export interface PaymentMethod {
  id: string;
  type: 'card' | 'paypal' | 'bank_transfer';
  last4?: string;
  expiryMonth?: number;
  expiryYear?: number;
  isDefault: boolean;
}

export interface CheckoutSession {
  id: string;
  invoiceId: string;
  amount: number;
  currency: string;
  status: 'pending' | 'completed' | 'failed';
  paymentMethod?: PaymentMethod;
  createdAt: number;
  completedAt?: number;
}
