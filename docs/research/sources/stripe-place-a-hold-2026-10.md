# Place a hold on a payment method

Separate payment authorisation and capture to create a charge now, but capture funds later.

When you create a payment, you can place a hold on an eligible payment method to reserve funds that you can capture later. For example, hotels often authorise a payment in full before a guest arrives, then capture the money when the guest checks out. This is sometimes referred to as *manual capture* (Manually capture funds separately from an authorization).

Authorising a payment guarantees the amount by holding it on the customer’s payment method. If you’re using the API, the [payment_method_details.card.capture_before](https://docs.stripe.com/api/charges/object.md#charge_object-payment_method_details-card-capture_before) attribute on the charge indicates when the authorisation expires.

You need to capture the funds before the authorisation expires. If the authorisation expires before you capture the funds, the funds are released and the payment status changes to `canceled`. Learn more about [statuses for asynchronous payments](https://docs.stripe.com/payments/paymentintents/lifecycle.md).

## Authorisation validity windows

The following tables outline validity windows for authorising different transaction types.

### Card-not-present transactions

| Card brand | [Merchant-Initiated Transaction](https://docs.stripe.com/payments/cits-and-mits.md) authorisation validity window | [Customer-Initiated Transaction](https://docs.stripe.com/payments/cits-and-mits.md) authorisation validity window |
| --- | --- | --- |
| **Visa** | 5 days* | 7 days |
| **Mastercard** | 7 days | 7 days |
| **American Express** | 7 days | 7 days |
| **Discover** | 7 days | 7 days |

The exact authorisation window is 4 days and 18 hours, to allow time for clearing processes.

> Stripe and the card network classify transactions as MIT or CIT based on signals of cardholder participation, not solely on API parameters like [off_session](https://docs.stripe.com/api/payment_intents/create.md#create_payment_intent-off_session). For example, a payment with `off_session: true` might still be classified as a CIT if a CVC is present, resulting in the CIT authorisation window instead.

### Card-present transactions (in-person payments)

| Card brand | Authorisation validity window |
| --- | --- |
| **Visa** | 5 days* |
| **Mastercard** | 2 days |
| **American Express** | 2 days |
| **Discover** | 2 days |

The exact authorisation window is 4 days and 18 hours, to allow time for clearing processes.

### 30-day authorisation windows in Japan

If your account is based in Japan, you can hold JPY-denominated transactions from Visa, Mastercard, JCB, Diners Club and Discover for up to 30 days. Non-JPY and American Express transactions expire according to the [standard authorisation windows](https://docs.stripe.com/payments/place-a-hold-on-a-payment-method.md#authorization-validity-windows).

## Payment method limitations

Before implementing, understand the following limitations for authorising and capturing separately.

- Only some payment methods support separate authorisation and *capture* (Fulfillment is the process of providing the goods or services purchased by a customer, typically after payment is collected). Some payment methods that support this include cards, Affirm, Afterpay, Cash App Pay, Klarna, and PayPal. Some payment methods that don’t support this include [ACH](https://docs.stripe.com/payments/ach-direct-debit.md) and [iDEAL](https://docs.stripe.com/payments/ideal.md). Read more about [payment method feature support](https://docs.stripe.com/payments/payment-methods/payment-method-support.md).

- Beyond what’s outlined in the tables above, other payment methods have different rules and authorisation windows:

  - Card payments: The amount is typically on hold for 7 days for online payments and 2 days for in-person Terminal payments (depending on the type of transaction and the card network). You can request an extended authorisation for certain [online](https://docs.stripe.com/payments/extended-authorization.md) and [Terminal payment authorisations](https://docs.stripe.com/terminal/features/extended-authorizations.md) that are eligible for extended validity periods. Card networks may also restrict 1 USD authorisations you don’t intend to capture.
  - [Affirm](https://docs.stripe.com/payments/affirm/accept-a-payment.md?payment-ui=direct-api#manual-capture): If Affirm requires a down payment for very large order amounts, they charge the amount during authorisation and refund if the payment isn’t captured. You then have 30 days to capture the payment balance.
  - [Afterpay / Clearpay](https://docs.stripe.com/payments/afterpay-clearpay/accept-a-payment.md?web-or-mobile=web&payment-ui=direct-api#manual-capture): During authorisation, the customer pays the first repayment instalment. Afterpay refunds the payment if it’s never captured. You then have 13 days to capture the payment balance.
  - [Cash App Pay](https://docs.stripe.com/payments/cash-app-pay/accept-a-payment.md?web-or-mobile=web&payment-ui=direct-api#manual-capture): Valid authorisations must be captured within 7 days to complete a payment.
  - [Klarna](https://docs.stripe.com/payments/klarna/accept-a-payment.md?web-or-mobile=web&payment-ui=direct-api#manual-capture): You must capture the charge by midnight of the 28th calendar day after the charge request, otherwise the authorisation expires. For example, you’d need to capture a charge request at UTC 2020-10-01 14:00 by UTC 2020-10-29 00:00.
  - [PayPal](https://docs.stripe.com/payments/paypal/accept-a-payment.md?web-or-mobile=web&payment-ui=direct-api#manual-capture): Holds the amount for 10 days. Stripe automatically attempts to extend the hold for another 10 days, totalling 20 days. Your [settlement preference](https://docs.stripe.com/payments/paypal/choose-settlement-preference.md) might affect the authorisation period. See [separate authorisation and capture](https://docs.stripe.com/payments/paypal/accept-a-payment.md?web-or-mobile=web&payment-ui=direct-api#manual-capture) for more information.

## Use the Dashboard to authorise and capture

You can authorise a payment and capture funds separately without writing code.

1. In the Dashboard, [create a new payment](https://dashboard.stripe.com/test/payments/new). Select **One-time**.
2. When you enter or select the payment method, select **More options** then **Capture funds later**.

The payment appears in your [payments page](https://dashboard.stripe.com/test/payments) as **Uncaptured**.

To capture the funds, go to the payment details page and click **Capture**.

## Tell Stripe to authorise only

#### Checkout Sessions API

To indicate that you want separate authorisation and capture, specify [capture_method](https://docs.stripe.com/api/checkout/sessions/create.md#create_checkout_session-payment_intent_data-capture_method) as `manual` when creating the Checkout Session. This parameter instructs Stripe to authorise the amount but not capture it on the customer’s payment method.

```curl
curl https://api.stripe.com/v1/checkout/sessions \
  -u "<<YOUR_SECRET_KEY>>:" \
  -d "line_items[0][price]={{PRICE_ID}}" \
  -d "line_items[0][quantity]=2" \
  -d mode=payment \
  -d ui_mode=elements \
  -d "payment_intent_data[capture_method]=manual"
```

With the above approach, you tell Stripe that you can only use “capture after” for a Checkout Session with eligible payment methods.

#### Payment Intents API

To indicate that you want separate authorisation and capture, specify [capture_method](https://docs.stripe.com/api/payment_intents/create.md#create_payment_intent-capture_method) as `manual` when creating the PaymentIntent. This parameter instructs Stripe to authorise the amount but not capture it on the customer’s payment method.

```curl
curl https://api.stripe.com/v1/payment_intents \
  -u "<<YOUR_SECRET_KEY>>:" \
  -d amount=1099 \
  -d currency=usd \
  -d "automatic_payment_methods[enabled]=true" \
  -d capture_method=manual
```

With the above approach, you tell Stripe that you can only use “capture after” for a PaymentIntent with eligible payment methods. For example, you can’t accept card payments and SEPA Direct Debit (which doesn’t support capture after) for a single PaymentIntent. To accept payment methods that might not all support capture after, you can configure capture-after-per-payment-method by configuring `capture_method=manual` on the `payment_method_options[<payment_method_type>]` object.

For example, by configuring `payment_method_options[card][capture_method]=manual`, you’re placing only card payments on hold. You can manage payment methods from the [Dashboard](https://dashboard.stripe.com/settings/payment_methods). Stripe handles the logic for [dynamically displaying](https://docs.stripe.com/payments/payment-methods/dynamic-payment-methods.md) the most relevant eligible payment methods to each customer based on factors such as the transaction’s amount, currency, and payment flow.

```curl
curl https://api.stripe.com/v1/payment_intents \
  -u "<<YOUR_SECRET_KEY>>:" \
  -d amount=1099 \
  -d currency=usd \
  -d "automatic_payment_methods[enabled]=true" \
  -d "payment_method_options[card][capture_method]=manual"
```

Alternatively, you can list `card` and `sepa_debit` using [allowed_payment_method_types](https://docs.stripe.com/api/payment_intents/create.md#create_payment_intent-allowed_payment_method_types), as in the following example.

```curl
curl https://api.stripe.com/v1/payment_intents \
  -u "<<YOUR_SECRET_KEY>>:" \
  -d amount=1099 \
  -d currency=eur \
  -d "allowed_payment_method_types[]=card" \
  -d "allowed_payment_method_types[]=sepa_debit" \
  -d "payment_method_options[card][capture_method]=manual"
```

Before continuing to capture, attach a payment method with card details to the PaymentIntent, and authorise the card by confirming the PaymentIntent. You can do this by setting the `payment_method` and `confirm` fields on the PaymentIntent.

> #### Extended authorisations
> 
> Usually, an authorisation for an online card payment is valid for 7 days. To increase the validity period, you can [place an extended hold on an online card payment](https://docs.stripe.com/payments/extended-authorization.md).

## Capture the funds

> #### Checkout Sessions has a PaymentIntent ID
> 
> If you’re using the Checkout Sessions API, make sure you use the [PaymentIntent ID](https://docs.stripe.com/api/checkout/sessions/object.md#checkout_session_object-payment_intent) that is returned in the Checkout Session object.

After the payment method is authorised, the PaymentIntent [status](https://docs.stripe.com/api/payment_intents/object.md#payment_intent_object-status) transitions to `requires_capture`. To capture the authorised funds, make a PaymentIntent [capture](https://docs.stripe.com/api/payment_intents/capture.md) request. This captures the total authorised amount by default. To capture less or (for certain online card payments) more than the initial amount, pass the [amount_to_capture](https://docs.stripe.com/api/payment_intents/capture.md#capture_payment_intent-amount_to_capture) option. A partial capture automatically releases the remaining amount. If attempting to capture more than the initial amount for an online card payment, refer to the [overcapture documentation](https://docs.stripe.com/payments/overcapture.md).

The following example demonstrates how to capture 7.50 USD of the authorised 10.99 USD payment:

```curl
curl https://api.stripe.com/v1/payment_intents/pi_123/capture \
  -u "<<YOUR_SECRET_KEY>>:" \
  -d amount_to_capture=750
```

Although some card payments are eligible for [multicapture](https://docs.stripe.com/payments/multicapture.md), you can only perform one capture on an authorised payment for most payments. If you partially capture a payment, you can’t perform another capture for the difference. (Instead, consider [saving the customer’s payment method details for later](https://docs.stripe.com/payments/save-during-payment.md?payment-ui=elements#save-payment-details-for-future-use) and creating future payments as needed.)

Card statements from some issuers and interfaces from payment methods don’t always distinguish between authorisations and captured (settled) payments, which can sometimes confuse customers.

Additionally, when a customer completes the payment process on a PaymentIntent with manual capture, it triggers the `payment_intent.amount_capturable_updated` event. You can inspect the PaymentIntent’s [amount_capturable](https://docs.stripe.com/api/payment_intents/object.md#payment_intent_object-amount_capturable) property to see the total amount that you can capture from the PaymentIntent.

## Cancel the authorisation

If you need to cancel an authorisation, you can [cancel the PaymentIntent](https://docs.stripe.com/refunds.md#cancel-payment).

## Capture payment before authorisation expires (Private preview)

You can instruct Stripe to automatically capture before authorisation expires instead of manually triggering capture for card payment methods. Use automatic delayed capture to ensure you don’t miss capturing authorised payments. You can also control when the capture occurs using the `capture_by` parameter.

To enable automatic delayed capture, set [capture_method](https://docs.stripe.com/api/payment_intents/create.md#create_payment_intent-payment_method_options-card) as `automatic_delayed` on the PaymentIntent:

```curl
curl https://api.stripe.com/v1/payment_intents \
  -u "<<YOUR_SECRET_KEY>>:" \
  -d amount=1099 \
  -d currency=usd \
  -d "automatic_payment_methods[enabled]=true" \
  -d "payment_method_options[card][capture_method]=automatic_delayed"
```

With this approach, Stripe captures your card payment before the authorisation expires, triggering the capture about 6 hours before the expiry time. This serves as a backup process to make sure we capture authorised payments before expiry. You can still manually [capture](https://docs.stripe.com/api/payment_intents/capture.md) or [cancel](https://docs.stripe.com/refunds.md#cancel-payment) the PaymentIntent before it’s automatically captured.

### Control capture timing

Use the `capture_by` parameter to control when funds are captured from the customer’s account. The following values are supported:

- `auth_expiry`: Captures funds before the authorisation expires. This is the default behaviour when `capture_by` is omitted.
- `end_of_day`: Captures funds at the end of the day (UTC).
- `target_delay`: Captures funds after a specified delay. When using `target_delay`, provide a `capture_delay` hash with `days` or `hours` to specify the delay period.

The following example uses `capture_by` set to `target_delay` with a `capture_delay` of 3 days to automatically capture the PaymentIntent 3 days after successful authorisation:

```curl
curl https://api.stripe.com/v1/payment_intents \
  -u "<<YOUR_SECRET_KEY>>:" \
  -d amount=1099 \
  -d currency=usd \
  -d "automatic_payment_methods[enabled]=true" \
  -d "payment_method_options[card][capture_method]=automatic_delayed" \
  -d "payment_method_options[card][capture_by]=target_delay" \
  -d "payment_method_options[card][capture_delay][days]=3"
```

This is useful if you know the amount of time needed to perform actions between authorisation and capture, and to make sure you capture the payment before the authorisation expires. You can set both `days` and `hours` as long as the total delay doesn’t exceed 30 days.

> With `capture_method=automatic_delayed`, Stripe prioritises capturing the payment before authorisation expiry. If the authorisation window is shorter than the specified delay period, we capture the PaymentIntent before expiry, ignoring the delay period.

### Interested in getting early access to automatic delayed captures?

Provide your email address below, and our team will contact you soon.

```bash
curl https://docs.stripe.com/preview/register \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Referer: https://docs.stripe.com/payments/place-a-hold-on-a-payment-method" \
  -d '{"email": "EMAIL", "preview": "automatic_delayed_capture_beta_preview"}'
```

## See also

- [Separate authorisation and capture with Checkout](https://docs.stripe.com/payments/accept-a-payment.md?payment-ui=checkout&ui=stripe-hosted#auth-and-capture)
- [Place an extended hold on an online card payment](https://docs.stripe.com/payments/extended-authorization.md)