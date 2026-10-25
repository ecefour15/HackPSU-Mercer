
{
  "cases": [
    {
      "id": "A1",
      "scenario": "auto_loan",
      "control": true,
      "title": "Straightforward used-car loan (no fees)",
      "offer_text": "Used sedan listed at $24,000. You put $4,000 down and finance the rest at 6.0% APR for 60 months. No dealer fees.",
      "inputs": {
        "price": 24000,
        "down_payment": 4000,
        "apr": 6,
        "term_months": 60
      },
      "expected": {
        "amount_financed": "20000.00",
        "monthly_payment": "386.66",
        "total_interest": "3199.36",
        "total_cost": "27199.36",
        "cash_due_at_signing": "4000.00",
        "true_apr_percent": "6.00"
      },
      "hidden_item": "None. This is a fair deal; the tool should NOT raise alarms.",
      "calculator_should_warn": false
    },
    {
      "id": "A2",
      "scenario": "auto_loan",
      "control": false,
      "title": "Financed documentation fee raises the real rate",
      "offer_text": "New compact SUV at $27,500. $2,500 down, 5.9% APR for 72 months. A $995 documentation and admin fee is added to the amount financed.",
      "inputs": {
        "price": 27500,
        "down_payment": 2500,
        "apr": 5.9,
        "term_months": 72,
        "upfront_fees": 995,
        "fees_financed": true
      },
      "expected": {
        "amount_financed": "25995.00",
        "monthly_payment": "429.59",
        "total_interest": "4935.21",
        "total_cost": "33430.21",
        "cash_due_at_signing": "2500.00",
        "true_apr_percent": "7.28"
      },
      "hidden_item": "The $995 fee is rolled into the loan, so the true APR is higher than the quoted 5.9%.",
      "calculator_should_warn": true
    },
    {
      "id": "A3",
      "scenario": "auto_loan",
      "control": false,
      "title": "Low monthly payment hides a very long term",
      "offer_text": "Pickup truck at $32,000, nothing down. 'Just $491 a month!' Financed at 7.5% APR for 84 months.",
      "inputs": {
        "price": 32000,
        "down_payment": 0,
        "apr": 7.5,
        "term_months": 84
      },
      "expected": {
        "amount_financed": "32000.00",
        "monthly_payment": "490.82",
        "total_interest": "9229.29",
        "total_cost": "41229.29",
        "cash_due_at_signing": "0.00",
        "true_apr_percent": "7.50"
      },
      "hidden_item": "An 84-month term means thousands in extra interest; the brief should show total interest, not just the monthly payment.",
      "calculator_should_warn": false
    },
    {
      "id": "A4",
      "scenario": "auto_loan_compare",
      "control": false,
      "title": "0% APR or $2,000 rebate? Compare total cost",
      "offer_text": "Sedan priced at $30,000. Option A: 0% APR for 60 months, no rebate. Option B: take a $2,000 rebate (price becomes $28,000) and finance with a bank at 4.5% APR for 60 months. Nothing down either way.",
      "inputs": {
        "a": {
          "price": 30000,
          "down_payment": 0,
          "apr": 0,
          "term_months": 60
        },
        "b": {
          "price": 28000,
          "down_payment": 0,
          "apr": 4.5,
          "term_months": 60
        }
      },
      "expected": {
        "a_total_cost": "30000.00",
        "b_total_cost": "31320.27",
        "cheaper": "A",
        "difference": "1320.27"
      },
      "hidden_item": "Decision case: compare TOTAL cost of each option, not the APR or the payment alone.",
      "calculator_should_warn": false
    },
    {
      "id": "A5",
      "scenario": "auto_loan",
      "control": false,
      "title": "Dealer fee due at signing",
      "offer_text": "Used hatchback at $18,000. $1,000 down plus a $600 dealer fee due at signing. 7.9% APR for 48 months on the rest.",
      "inputs": {
        "price": 18000,
        "down_payment": 1000,
        "apr": 7.9,
        "term_months": 48,
        "upfront_fees": 600,
        "fees_financed": false
      },
      "expected": {
        "amount_financed": "17000.00",
        "monthly_payment": "414.22",
        "total_interest": "2882.66",
        "total_cost": "21482.66",
        "cash_due_at_signing": "1600.00",
        "true_apr_percent": "9.78"
      },
      "hidden_item": "Cash needed at signing is $1,600, not $1,000, and the fee pushes the true APR above 7.9%.",
      "calculator_should_warn": true
    },
    {
      "id": "L1",
      "scenario": "lease",
      "control": false,
      "title": "Standard lease with a large due-at-signing amount",
      "offer_text": "36-month lease. Capitalized cost $36,000, residual value $21,600, money factor 0.00150. $2,999 due at signing and a $395 disposition fee at lease end.",
      "inputs": {
        "cap_cost": 36000,
        "residual_value": 21600,
        "term_months": 36,
        "money_factor": "0.00150",
        "due_at_signing": 2999,
        "disposition_fee": 395
      },
      "expected": {
        "monthly_payment_pre_tax": "486.40",
        "total_lease_cost": "20904.40",
        "approx_apr_percent": "3.60",
        "effective_cost_per_month": "580.68"
      },
      "hidden_item": "$2,999 due at signing is much more than three monthly payments, so the 'low monthly' headline understates the cost.",
      "calculator_should_warn": true
    },
    {
      "id": "L2",
      "scenario": "lease",
      "control": false,
      "title": "Marked-up money factor (about 7% APR)",
      "offer_text": "Same 36-month lease as above, but the paperwork shows a money factor of 0.00290 (the manufacturer's base rate was 0.00150). $2,999 due at signing, $395 disposition fee.",
      "inputs": {
        "cap_cost": 36000,
        "residual_value": 21600,
        "term_months": 36,
        "money_factor": "0.00290",
        "due_at_signing": 2999,
        "disposition_fee": 395
      },
      "expected": {
        "monthly_payment_pre_tax": "567.04",
        "total_lease_cost": "23807.44",
        "approx_apr_percent": "6.96",
        "effective_cost_per_month": "661.32"
      },
      "hidden_item": "A money factor of 0.00290 is roughly a 6.96% APR, nearly double the base rate; the money factor is negotiable.",
      "calculator_should_warn": true
    },
    {
      "id": "L3",
      "scenario": "lease",
      "control": false,
      "title": "Small monthly fee that adds up",
      "offer_text": "24-month lease. Capitalized cost $28,000, residual value $16,800, money factor 0.00110. $0 due at signing. A $12 monthly 'service fee' is added to each payment.",
      "inputs": {
        "cap_cost": 28000,
        "residual_value": 16800,
        "term_months": 24,
        "money_factor": "0.00110",
        "due_at_signing": 0,
        "monthly_fees": 12,
        "disposition_fee": 0
      },
      "expected": {
        "monthly_payment_pre_tax": "527.95",
        "total_lease_cost": "12670.72",
        "approx_apr_percent": "2.64",
        "effective_cost_per_month": "527.95"
      },
      "hidden_item": "The $12 monthly fee adds $288 over the lease; the brief should include it in the real monthly cost.",
      "calculator_should_warn": false
    },
    {
      "id": "B1",
      "scenario": "bnpl",
      "control": true,
      "title": "Plain pay-in-4, no fees (control)",
      "offer_text": "Pay in 4 for a $400 jacket: $100 today and three payments of $100 every two weeks. No interest, no fees.",
      "inputs": {
        "price": 400,
        "installments": 4,
        "first_payment_percent": 25
      },
      "expected": {
        "first_payment": "100.00",
        "later_payment_each": "100.00",
        "fees_total": "0.00",
        "total_cost": "400.00",
        "extra_cost_vs_cash": "0.00"
      },
      "hidden_item": "None. Costs exactly the cash price; the tool should NOT raise alarms.",
      "calculator_should_warn": false
    },
    {
      "id": "B2",
      "scenario": "bnpl",
      "control": false,
      "title": "Interest-bearing installment plan",
      "offer_text": "Laptop bag set for $1,000. Pay 20% today and the remaining 5 monthly payments at 29.99% APR.",
      "inputs": {
        "price": 1000,
        "installments": 6,
        "first_payment_percent": 20,
        "interest_apr": 29.99
      },
      "expected": {
        "first_payment": "200.00",
        "later_payment_each": "172.19",
        "fees_total": "0.00",
        "total_cost": "1060.97",
        "extra_cost_vs_cash": "60.97"
      },
      "hidden_item": "Not 'free' financing: the plan carries a high APR and costs extra over the cash price.",
      "calculator_should_warn": true
    },
    {
      "id": "B3",
      "scenario": "bnpl",
      "control": false,
      "title": "Per-payment fees plus two late payments",
      "offer_text": "Pay in 4 for a $600 purchase, $3 convenience fee on each installment. Assume two payments are late, each with a $7 late fee.",
      "inputs": {
        "price": 600,
        "installments": 4,
        "first_payment_percent": 25,
        "fee_per_installment": 3,
        "late_payments": 2,
        "late_fee": 7
      },
      "expected": {
        "first_payment": "150.00",
        "later_payment_each": "150.00",
        "fees_total": "26.00",
        "total_cost": "626.00",
        "extra_cost_vs_cash": "26.00"
      },
      "hidden_item": "Fees total $26 on a 'no-interest' plan: $12 in installment fees plus $14 in late fees.",
      "calculator_should_warn": true
    },
    {
      "id": "C1",
      "scenario": "card",
      "control": false,
      "title": "Paying a flat $100/month on a high-APR card",
      "offer_text": "Credit card balance of $3,000 at 24% APR. You plan to pay $100 a month and make no new purchases.",
      "inputs": {
        "balance": 3000,
        "apr": 24,
        "monthly_payment": 100
      },
      "expected": {
        "months_to_payoff": "47",
        "total_interest": "1627.31",
        "total_paid": "4627.31"
      },
      "hidden_item": "Nearly four years to pay off and over $1,600 in interest; show how a larger payment shortens this.",
      "calculator_should_warn": false
    }
  ]
}