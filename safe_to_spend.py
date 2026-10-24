"""Conservative, explainable safe-to-spend forecast. Local calculations only."""
from calendar import monthrange
from datetime import timedelta
from pathlib import Path
import io
import pandas as pd
import streamlit as st

DATA_PATH = Path(__file__).resolve().parent / 'synthetic_bank_transactions.csv'


def usd(value):
    return f'${value:,.2f}'


@st.cache_data(show_spinner=False)
def load_transactions(blob):
    df = pd.read_csv(io.BytesIO(blob))
    needed = {'posted_date', 'amount_usd', 'transaction_type', 'merchant', 'recurring', 'running_balance_usd'}
    if not needed.issubset(df.columns):
        raise ValueError('CSV needs: ' + ', '.join(sorted(needed)))
    df['posted_date'] = pd.to_datetime(df['posted_date'], errors='coerce')
    for field in ['amount_usd','running_balance_usd']:
        df[field] = pd.to_numeric(df[field], errors='coerce')
    df = df.dropna(subset=['posted_date','amount_usd']).sort_values('posted_date', kind='stable')
    if df.empty:
        raise ValueError('No valid dated transactions.')
    return df


def calculate_forecast(df, balance, start_date, horizon, savings, buffer, variable_override=None):
    """Does NOT assume future deposits or count internal transfers as consumption.

    All future recurring bills in the window are reserved upfront. Variable
    expenses are reserved based on history, preventing the same dollars being
    labelled safe-to-spend while also needed for necessities.
    """
    end = start_date + timedelta(days=horizon)
    types = df['transaction_type'].astype(str).str.lower().str.strip()
    expense = df.loc[types.eq('expense') & df['amount_usd'].lt(0)].copy()
    expense['is_recurring'] = expense['recurring'].astype(str).str.lower().isin(['yes', 'true', '1'])
    recurring = expense[expense['is_recurring']].copy()
    recurring['month'] = recurring['posted_date'].dt.to_period('M')
    recurring['day'] = recurring['posted_date'].dt.day
    recurring['merchant'] = recurring['merchant'].fillna('Unknown merchant').astype(str)
    recurring['category'] = recurring.get('category', pd.Series('', index=recurring.index)).fillna('Other')
    bills = []
    for merchant, group in recurring.groupby('merchant'):
        # Exclude rare one-time charges accidentally flagged as recurring.
        monthly = group.sort_values('posted_date').drop_duplicates('month', keep='last')
        if len(monthly) < 2:
            continue
        day = int(round(monthly['day'].median()))
        # Recent 3 observations allow small seasonal utility changes.
        estimate = float((-monthly.tail(3)['amount_usd']).median())
        category = str(monthly.iloc[-1]['category'])
        bills.append((merchant, category, day, estimate))

    bill_events = []
    months = pd.period_range(start=start_date.to_period('M'), end=end.to_period('M'), freq='M')
    for month in months:
        year, m = month.year, month.month
        for merchant, category, day, amount in bills:
            actual_day = min(day, monthrange(year, m)[1])
            due = pd.Timestamp(year, m, actual_day)
            if start_date < due <= end:
                bill_events.append({'Date': due, 'Bill': merchant, 'Category': category, 'Estimated cost': round(amount,2)})
    events = pd.DataFrame(bill_events, columns=['Date','Bill','Category','Estimated cost'])
    if not events.empty:
        events = events.sort_values(['Date','Bill']).reset_index(drop=True)

    # Use complete months only for average non-recurring spending.
    expense['month'] = expense['posted_date'].dt.to_period('M')
    available_months = sorted(df['posted_date'].dt.to_period('M').unique())
    latest = df['posted_date'].max()
    full_months = [m for m in available_months if m < latest.to_period('M') or latest.day == monthrange(latest.year, latest.month)[1]]
    sample_months = full_months[-6:]
    variable = expense.loc[(~expense['is_recurring']) & expense['month'].isin(sample_months)]
    variable_monthly = float(-variable['amount_usd'].sum() / len(sample_months)) if sample_months else 0.0
    variable_reserved = (variable_monthly * horizon / 30.4375) if variable_override is None else variable_override
    bills_reserved = float(events['Estimated cost'].sum()) if not events.empty else 0.0
    committed = bills_reserved + savings + buffer + variable_reserved
    spendable = max(0., balance - committed)

    # Daily projection includes fixed bills on due dates, and a smooth baseline
    # for variable spending, savings contributions and a one-time proposed spend.
    daily = []
    running = float(balance)
    daily_bills = events.groupby('Date')['Estimated cost'].sum().to_dict() if not events.empty else {}
    for offset in range(1, horizon+1):
        date = start_date + timedelta(days=offset)
        running -= float(daily_bills.get(date, 0.0)) + (variable_reserved+savings)/horizon
        daily.append({'Date': date, 'Projected balance': running, 'Safety buffer': buffer})
    return {'safe': spendable, 'bills': bills_reserved, 'variable': variable_reserved,
            'savings': savings, 'buffer': buffer, 'committed': committed,
            'events': events, 'daily': pd.DataFrame(daily),
            'variable_monthly': variable_monthly, 'start': start_date, 'end': end,
            'estimated_bill_count': len(bills), 'complete_months': len(sample_months)}


def render_safe_to_spend():
    st.divider()
    st.header('💳 Safe-to-Spend Forecast')
    st.write('Know what is actually available **after upcoming bills, everyday spending, savings contributions, and a safety cushion.**')
    st.caption('Conservative demonstration: predicts from posted transactions. Future paychecks and refunds are NOT assumed, and predictions are not guarantees.')
    upload = st.file_uploader('Optional: upload a bank transactions CSV', type=['csv'], key='safe_csv')
    try:
        df = load_transactions(upload.getvalue() if upload else DATA_PATH.read_bytes())
    except Exception as exc:
        st.error(f'Unable to load transaction data: {exc}')
        return
    last = df.iloc[-1]
    last_date = df['posted_date'].max().normalize()
    # Last chronological row from the input is the snapshot balance; stable date sort
    # preserves same-day posting order from the bank export.
    snapshot_balance = float(last['running_balance_usd']) if pd.notna(last['running_balance_usd']) else 0.0
    if pd.isna(last['running_balance_usd']):
        st.warning('Latest account balance missing; enter a current balance.')

    st.caption(f"Demo data ends **{last_date.date()}**. This is a historical scenario, not a live bank balance. Transactions loaded: {len(df)}.")
    c1,c2,c3 = st.columns(3)
    with c1:
        balance = st.number_input('Checking balance ($)', min_value=0., value=max(0.,snapshot_balance), step=50., key='safe_balance')
    with c2:
        horizon = st.selectbox('Plan ahead', options=[7,14,30,45,60], index=2, format_func=lambda d:f'{d} days', key='safe_horizon')
    with c3:
        buffer = st.number_input('Minimum account cushion ($)', min_value=0., value=500., step=50., key='safe_buffer')
    c4,c5 = st.columns(2)
    with c4:
        savings = st.number_input('Savings reserved during forecast ($)', min_value=0., value=650., step=25., key='safe_savings')
    with c5:
        variable_mode = st.selectbox('Everyday spending estimate', ['Based on historical transactions','Custom reserve'], key='safe_variable_mode')
    variable_override = None
    if variable_mode == 'Custom reserve':
        variable_override = st.number_input('Everyday spending reserve for entire period ($)', min_value=0., value=750., step=50., key='safe_variable')

    result = calculate_forecast(df, balance, last_date, horizon, savings, buffer, variable_override)
    st.subheader('Your available money')
    x,y,z = st.columns(3)
    x.metric('Checking balance', usd(balance))
    y.metric('Estimated safe to spend', usd(result['safe']))
    z.metric('Reserved / protected', usd(result['committed']))
    if balance < result['committed']:
        st.error(f"Your reserves exceed your balance by {usd(result['committed']-balance)}. Avoid extra purchases and review upcoming commitments.")
    elif result['safe'] < balance * .15:
        st.warning('Your free-spending margin is small. Consider holding off on nonessential purchases.')
    else:
        st.success('This amount remains after your modeled obligations. It is not a spending guarantee.')

    st.subheader('Where your balance needs to go')
    breakdown = pd.DataFrame({'Reserve':['Upcoming recurring bills','Estimated variable expenses','Savings goal','Checking cushion'],
        'Amount ($)':[result['bills'],result['variable'],savings,buffer]})
    st.dataframe(breakdown.style.format({'Amount ($)':'${:,.2f}'}), hide_index=True, use_container_width=True)

    left,right = st.columns([1.2,1])
    with left:
        st.subheader('Projected checking balance')
        trend = result['daily'].set_index('Date')[['Projected balance','Safety buffer']]
        st.line_chart(trend, use_container_width=True)
        st.caption('Forecast subtracts scheduled bills on estimated due dates and spreads variable spending and savings evenly; it assumes no new income.')
    with right:
        st.subheader('Try a purchase')
        purchase = st.number_input('What if I spend ($)', min_value=0., value=250., step=25., key='safe_purchase')
        after = balance - result['committed'] - purchase
        st.metric('Left after purchase & reserves',usd(max(0,after)))
        if after < 0:
            st.error(f'This purchase exceeds modeled discretionary funds by {usd(-after)}.')
        else:
            st.success('This purchase fits the current conservative forecast.')
        st.caption('A purchase here is hypothetical and does not modify your transaction file.')

    st.subheader('Expected upcoming bills')
    if result['events'].empty:
        st.info('No estimated recurring bill dates fall inside this forecast window.')
    else:
        view = result['events'].copy()
        view['Date'] = view['Date'].dt.strftime('%b %d, %Y')
        st.dataframe(view.style.format({'Estimated cost':'${:,.2f}'}), hide_index=True, use_container_width=True)
    st.caption(f"Bill estimates come from repeat merchants marked recurring (at least 2 months, median of up to 3 recent bills). Variable spending averages {result['complete_months']} complete observed months: {usd(result['variable_monthly'])}/month. Due dates are estimates; reconcile pending payments and actual invoices. Savings reserve is user-specified for the whole forecast window.")
    st.info('Privacy: forecast calculations run locally in Streamlit and do not send transaction details to the AI model.')
