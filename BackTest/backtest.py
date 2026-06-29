#!/usr/bin/env python3

import argparse
import csv
import html
import json
import math
import random
import sys
import time
import webbrowser
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
VALID_SYMBOLS = {"TQQQ", "SOXL"}
VALID_PRICE_SYMBOLS = VALID_SYMBOLS | {"QLD"}
BENCHMARK_SYMBOL = "QLD"
VALID_SPLITS = {20, 30, 40}


@dataclass
class Price:
    date: str
    open: float
    high: float
    low: float
    close: float
    adj_close: float
    volume: int


@dataclass
class Execution:
    round_number: int
    date: str
    side: str
    order_type: str
    label: str
    price: float
    quantity: int
    amount: float
    t_effect: str


@dataclass
class RoundResult:
    round_number: int
    started_at: str
    ended_at: str
    started_principal: float
    ending_cash_balance: float
    profit_amount: float
    profit_rate: float
    execution_count: int


@dataclass
class State:
    symbol: str
    split_count: int
    principal: float
    compounding_type: str
    cash_balance: float
    position_qty: int
    avg_price: float
    t_value: float
    mode: str
    reverse_first_sell_done: bool
    round_number: int
    round_started_at: str | None


def round_money(value: float) -> float:
    return 0.0 if not math.isfinite(value) else round(value, 4)


def round_price(value: float) -> float:
    return 0.0 if not math.isfinite(value) else round(value, 2)


def round_t(value: float) -> float:
    return 0.0 if not math.isfinite(value) else round(value, 10)


def floor_shares(value: float) -> int:
    return 0 if not math.isfinite(value) or value <= 0 else math.floor(value)


def money(value: float) -> str:
    return f"${value:,.2f}"


def percent(value: float) -> str:
    return f"{value:,.2f}%"


def parse_yyyy_mm_dd(value: str, label: str) -> str:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError(f"{label} must be YYYY-MM-DD") from exc
    return value


def unix_seconds(date_value: str) -> int:
    date = datetime.strptime(date_value, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return int(date.timestamp())


def default_csv_path(symbol: str) -> Path:
    return ROOT / "data" / f"{symbol}.csv"


def download_prices(symbol: str, start_date: str, end_date: str, out_path: Path) -> Path:
    symbol = symbol.upper()
    if symbol not in VALID_PRICE_SYMBOLS:
        raise ValueError("Only TQQQ, SOXL, and QLD are supported")

    parse_yyyy_mm_dd(start_date, "start_date")
    parse_yyyy_mm_dd(end_date, "end_date")
    end_plus_one = (datetime.strptime(end_date, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")

    params = urlencode(
        {
            "period1": unix_seconds(start_date),
            "period2": unix_seconds(end_plus_one),
            "interval": "1d",
            "events": "history|split|div",
        }
    )
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?{params}"
    request = Request(url, headers={"User-Agent": "Mozilla/5.0"})

    with urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))

    error = payload.get("chart", {}).get("error")
    if error:
        raise RuntimeError(error.get("description") or error.get("code") or "Yahoo request failed")

    result = payload.get("chart", {}).get("result", [None])[0]
    if not result or not result.get("timestamp"):
        raise RuntimeError("Yahoo returned no price data")

    quote = result.get("indicators", {}).get("quote", [None])[0]
    adj_close = result.get("indicators", {}).get("adjclose", [{}])[0].get("adjclose", [])
    if not quote:
        raise RuntimeError("Yahoo returned no OHLC data")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    rows = []
    for index, timestamp in enumerate(result["timestamp"]):
        close = quote.get("close", [])[index]
        adjusted_close = adj_close[index] if index < len(adj_close) else close
        if close is None or adjusted_close is None or close <= 0:
            continue

        ratio = adjusted_close / close
        rows.append(
            {
                "date": datetime.fromtimestamp(timestamp, tz=timezone.utc).strftime("%Y-%m-%d"),
                "open": round((quote.get("open", [])[index] or 0) * ratio, 6),
                "high": round((quote.get("high", [])[index] or 0) * ratio, 6),
                "low": round((quote.get("low", [])[index] or 0) * ratio, 6),
                "close": round(close * ratio, 6),
                "adj_close": round(adjusted_close, 6),
                "volume": int(quote.get("volume", [0])[index] or 0),
            }
        )

    if not rows:
        raise RuntimeError("No valid rows after filtering Yahoo data")

    with out_path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=["date", "open", "high", "low", "close", "adj_close", "volume"])
        writer.writeheader()
        writer.writerows(rows)

    return out_path


def load_prices(csv_path: Path, start_date: str, end_date: str) -> list[Price]:
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    rows: list[Price] = []
    seen = set()
    with csv_path.open("r", newline="", encoding="utf-8") as file:
        for row in csv.DictReader(file):
            date = row["date"]
            if date < start_date or date > end_date:
                continue
            if date in seen:
                raise ValueError(f"Duplicate price date: {date}")
            seen.add(date)

            price = Price(
                date=date,
                open=float(row["open"]),
                high=float(row["high"]),
                low=float(row["low"]),
                close=float(row["close"]),
                adj_close=float(row.get("adj_close") or row["close"]),
                volume=int(float(row.get("volume") or 0)),
            )
            if min(price.open, price.high, price.low, price.close) <= 0:
                raise ValueError(f"Invalid OHLC row: {date}")
            rows.append(price)

    rows.sort(key=lambda item: item.date)
    if len(rows) < 6:
        raise ValueError("Need at least 6 trading days for a useful backtest")
    return rows


def calculate_star_percent(symbol: str, split_count: int, t_value: float) -> float:
    if symbol == "TQQQ":
        return (15 - (30 / split_count) * t_value) / 100
    return (20 - (40 / split_count) * t_value) / 100


def reverse_sell_divisor(split_count: int) -> float:
    return split_count / 2


def reverse_sell_t_multiplier(split_count: int) -> float:
    return 1 - (2 / split_count)


def apply_t_effect(t_value: float, effect: str, split_count: int) -> float:
    if effect == "buy_full":
        return round_t(t_value + 1)
    if effect == "buy_half":
        return round_t(t_value + 0.5)
    if effect == "quarter_sell":
        return round_t(t_value * 0.75)
    if effect == "limit_sell":
        return round_t(t_value * 0.25)
    if effect == "limit_sell_then_full_buy":
        return round_t(t_value * 0.25 + 1)
    if effect == "limit_sell_then_half_buy":
        return round_t(t_value * 0.25 + 0.5)
    if effect == "reverse_sell":
        return round_t(t_value * reverse_sell_t_multiplier(split_count))
    if effect == "reverse_buy":
        return round_t(t_value + (split_count - t_value) * 0.25)
    return round_t(t_value)


def loc_buy_execution_price(day: Price, limit_price: float) -> float | None:
    if limit_price <= 0 or day.close > limit_price:
        return None
    return day.close


def loc_sell_execution_price(day: Price, limit_price: float) -> float | None:
    if limit_price <= 0 or day.close < limit_price:
        return None
    return day.close


def limit_sell_execution_price(day: Price, limit_price: float) -> float | None:
    if limit_price <= 0 or day.high < limit_price:
        return None
    return limit_price


def average(values: list[float]) -> float | None:
    return None if not values else sum(values) / len(values)


def record_execution(executions: list[Execution], state: State, day: Price, side: str, order_type: str, label: str, price: float, quantity: int, t_effect: str) -> None:
    executions.append(
        Execution(
            round_number=state.round_number,
            date=day.date,
            side=side,
            order_type=order_type,
            label=label,
            price=round_price(price),
            quantity=quantity,
            amount=round_money(price * quantity),
            t_effect=t_effect,
        )
    )


def create_initial_state(symbol: str, split_count: int, principal: float, compounding_type: str, day: Price) -> State:
    one_unit_budget = round_money(principal / split_count)
    quantity = floor_shares(one_unit_budget / day.close)
    if quantity <= 0:
        raise ValueError("Principal is too small to buy the first share")

    amount = round_money(quantity * day.close)
    return State(
        symbol=symbol,
        split_count=split_count,
        principal=principal,
        compounding_type=compounding_type,
        cash_balance=round_money(principal - amount),
        position_qty=quantity,
        avg_price=day.close,
        t_value=1,
        mode="normal",
        reverse_first_sell_done=False,
        round_number=1,
        round_started_at=day.date,
    )


def buy(state: State, executions: list[Execution], day: Price, label: str, price: float, budget: float, t_effect: str, order_type: str = "LOC") -> bool:
    execution_price = price
    if order_type == "LOC":
        loc_price = loc_buy_execution_price(day, price)
        if loc_price is None:
            return False
        execution_price = loc_price

    spendable = min(budget, state.cash_balance)
    quantity = floor_shares(spendable / price)
    if quantity <= 0:
        return False

    amount = round_money(quantity * execution_price)
    previous_cost = state.avg_price * state.position_qty
    state.cash_balance = round_money(state.cash_balance - amount)
    state.position_qty += quantity
    state.avg_price = round_price((previous_cost + amount) / state.position_qty)
    state.t_value = apply_t_effect(state.t_value, t_effect, state.split_count)
    record_execution(executions, state, day, "buy", order_type, label, execution_price, quantity, t_effect)
    return True


def sell(state: State, executions: list[Execution], day: Price, label: str, order_type: str, price: float, quantity: int, t_effect: str) -> bool:
    sell_qty = min(quantity, state.position_qty)
    if sell_qty <= 0:
        return False
    execution_price = price
    if order_type == "LIMIT":
        limit_price = limit_sell_execution_price(day, price)
        if limit_price is None:
            return False
        execution_price = limit_price
    if order_type == "LOC":
        loc_price = loc_sell_execution_price(day, price)
        if loc_price is None:
            return False
        execution_price = loc_price

    state.cash_balance = round_money(state.cash_balance + sell_qty * execution_price)
    state.position_qty -= sell_qty
    state.t_value = apply_t_effect(state.t_value, t_effect, state.split_count)
    if state.position_qty == 0:
        state.avg_price = 0
    record_execution(executions, state, day, "sell", order_type, label, execution_price, sell_qty, t_effect)
    return True


def complete_round(state: State, rounds: list[RoundResult], executions: list[Execution], day: Price) -> None:
    round_executions = [execution for execution in executions if execution.round_number == state.round_number]
    profit_amount = round_money(state.cash_balance - state.principal)
    profit_rate = (profit_amount / state.principal) * 100 if state.principal > 0 else 0
    rounds.append(
        RoundResult(
            round_number=state.round_number,
            started_at=state.round_started_at or day.date,
            ended_at=day.date,
            started_principal=state.principal,
            ending_cash_balance=state.cash_balance,
            profit_amount=profit_amount,
            profit_rate=profit_rate,
            execution_count=len(round_executions),
        )
    )

    if state.compounding_type == "compound":
        state.principal = state.cash_balance
    state.position_qty = 0
    state.avg_price = 0
    state.t_value = 0
    state.mode = "normal"
    state.reverse_first_sell_done = False
    state.round_number += 1
    state.round_started_at = None


def start_next_round_if_needed(state: State, executions: list[Execution], day: Price) -> bool:
    if state.position_qty != 0 or state.t_value != 0:
        return False

    one_unit_budget = round_money(state.principal / state.split_count)
    quantity = floor_shares(min(one_unit_budget, state.cash_balance) / day.close)
    if quantity <= 0:
        return False

    amount = round_money(quantity * day.close)
    state.cash_balance = round_money(state.cash_balance - amount)
    state.position_qty = quantity
    state.avg_price = day.close
    state.t_value = 1
    state.round_started_at = day.date
    record_execution(executions, state, day, "buy", "MOC", "new round first buy", day.close, quantity, "buy_full")
    return True


def process_normal_day(state: State, executions: list[Execution], rounds: list[RoundResult], day: Price) -> None:
    if state.t_value > state.split_count - 1:
        state.mode = "reverse"
        state.reverse_first_sell_done = False
        return

    starting_t = state.t_value
    starting_position_qty = state.position_qty
    avg_price_for_plan = state.avg_price
    star_percent = calculate_star_percent(state.symbol, state.split_count, starting_t)
    star_price = round_price(avg_price_for_plan * (1 + star_percent))
    buy_price = round_price(star_price - 0.01)
    target_sell_price = round_price(avg_price_for_plan * (1.15 if state.symbol == "TQQQ" else 1.2))
    one_unit_budget = round_money(state.cash_balance / max(state.split_count - starting_t, 1))
    quarter_sell_qty = floor_shares(starting_position_qty / 4)
    final_sell_qty = max(starting_position_qty - quarter_sell_qty, 0)

    sell(state, executions, day, "quarter sell", "LOC", star_price, quarter_sell_qty, "quarter_sell")
    sell(state, executions, day, "final limit sell", "LIMIT", target_sell_price, final_sell_qty, "limit_sell")
    if state.position_qty == 0:
        complete_round(state, rounds, executions, day)
        return

    if starting_t < state.split_count / 2:
        half_budget = round_money(one_unit_budget / 2)
        buy(state, executions, day, "first half star buy", buy_price, half_budget, "buy_half")
        buy(state, executions, day, "first half avg buy", round_price(avg_price_for_plan), half_budget, "buy_half")
    else:
        buy(state, executions, day, "second half star buy", buy_price, one_unit_budget, "buy_full")


def process_reverse_day(state: State, executions: list[Execution], day: Price, previous_closes: list[float]) -> None:
    sell_qty = floor_shares(state.position_qty / reverse_sell_divisor(state.split_count))
    if not state.reverse_first_sell_done:
        sell(state, executions, day, "reverse first sell", "MOC", day.close, sell_qty, "reverse_sell")
        state.reverse_first_sell_done = True
        return

    reference_price = average(previous_closes[-5:])
    if reference_price is None:
        return

    if day.close > reference_price:
        sell(state, executions, day, "reverse sell", "MOC", day.close, sell_qty, "reverse_sell")
    elif day.close < reference_price:
        buy(state, executions, day, "reverse buy", day.close, round_money(state.cash_balance * 0.25), "reverse_buy", "MOC")

    return_line = state.avg_price * (0.85 if state.symbol == "TQQQ" else 0.8)
    if state.position_qty > 0 and day.close > return_line:
        state.mode = "normal"
        state.reverse_first_sell_done = False


def calculate_mdd(equity_curve: list[dict]) -> float:
    peak = equity_curve[0]["equity"] if equity_curve else 0
    max_drawdown = 0.0
    for point in equity_curve:
        peak = max(peak, point["equity"])
        drawdown = ((point["equity"] - peak) / peak) * 100 if peak > 0 else 0
        max_drawdown = min(max_drawdown, drawdown)
    return max_drawdown


def simulate(symbol: str, split_count: int, principal: float, compounding_type: str, prices: list[Price]) -> dict:
    state = create_initial_state(symbol, split_count, principal, compounding_type, prices[0])
    executions: list[Execution] = []
    rounds: list[RoundResult] = []
    equity_curve = []

    record_execution(executions, state, prices[0], "buy", "MOC", "initial first buy", prices[0].close, state.position_qty, "buy_full")
    equity_curve.append({"date": prices[0].date, "equity": round_money(state.cash_balance + state.position_qty * prices[0].close)})

    for index, day in enumerate(prices[1:], start=1):
        previous_closes = [price.close for price in prices[max(0, index - 5):index]]
        opened_new_round = start_next_round_if_needed(state, executions, day)
        if opened_new_round:
            equity_curve.append({"date": day.date, "equity": round_money(state.cash_balance + state.position_qty * day.close)})
            continue

        if state.position_qty > 0:
            if state.mode == "normal":
                process_normal_day(state, executions, rounds, day)
            else:
                process_reverse_day(state, executions, day, previous_closes)

        if state.position_qty == 0 and state.round_started_at is not None:
            complete_round(state, rounds, executions, day)

        equity_curve.append({"date": day.date, "equity": round_money(state.cash_balance + state.position_qty * day.close)})

    last_price = prices[-1]
    ending_equity = round_money(state.cash_balance + state.position_qty * last_price.close)
    profit_amount = round_money(ending_equity - principal)
    profit_rate = (profit_amount / principal) * 100 if principal > 0 else 0

    return {
        "config": {
            "symbol": symbol,
            "split_count": split_count,
            "principal": principal,
            "compounding_type": compounding_type,
        },
        "period": {"start": prices[0].date, "end": last_price.date, "trading_days": len(prices)},
        "summary": {
            "ending_equity": ending_equity,
            "profit_amount": profit_amount,
            "profit_rate": profit_rate,
            "max_drawdown": calculate_mdd(equity_curve),
            "completed_rounds": len(rounds),
            "execution_count": len(executions),
            "open_position_qty": state.position_qty,
            "cash_balance": state.cash_balance,
        },
        "rounds": [asdict(round_result) for round_result in rounds],
        "executions": [asdict(execution) for execution in executions],
        "equity_curve": equity_curve,
    }


def print_result(result: dict) -> None:
    config = result["config"]
    period = result["period"]
    summary = result["summary"]
    print("\nBacktest Summary")
    print("================")
    print(f"Symbol: {config['symbol']} {config['split_count']} split ({config['compounding_type']})")
    print(f"Period: {period['start']} ~ {period['end']} ({period['trading_days']} trading days)")
    print(f"Ending equity: {money(summary['ending_equity'])}")
    print(f"Profit: {money(summary['profit_amount'])} ({percent(summary['profit_rate'])})")
    print(f"MDD: {percent(summary['max_drawdown'])}")
    print(f"Completed rounds: {summary['completed_rounds']}")
    print(f"Executions: {summary['execution_count']}")
    print(f"Open position: {summary['open_position_qty']} shares, cash {money(summary['cash_balance'])}")

    if result["rounds"]:
        print("\nCompleted Rounds")
        print("round | start      | end        | principal  | ending cash | profit     | return | executions")
        print("------|------------|------------|------------|-------------|------------|--------|-----------")
        for item in result["rounds"]:
            print(
                f"{item['round_number']:>5} | {item['started_at']} | {item['ended_at']} | "
                f"{money(item['started_principal']):>10} | {money(item['ending_cash_balance']):>11} | "
                f"{money(item['profit_amount']):>10} | {percent(item['profit_rate']):>6} | {item['execution_count']:>9}"
            )


def validate_common(symbol: str, split_count: int | None = None, principal: float | None = None) -> str:
    symbol = symbol.upper()
    if symbol not in VALID_SYMBOLS:
        raise ValueError("Only TQQQ and SOXL are supported for strategy backtests")
    if split_count is not None and split_count not in VALID_SPLITS:
        raise ValueError("split_count must be 20, 30, or 40")
    if principal is not None and principal <= 0:
        raise ValueError("principal must be positive")
    return symbol


def validate_price_symbol(symbol: str) -> str:
    symbol = symbol.upper()
    if symbol not in VALID_PRICE_SYMBOLS:
        raise ValueError("Only TQQQ, SOXL, and QLD are supported for price downloads")
    return symbol


def command_download(args: argparse.Namespace) -> None:
    symbol = validate_price_symbol(args.symbol)
    out_path = Path(args.out) if args.out else default_csv_path(symbol)
    saved_path = download_prices(symbol, args.start_date, args.end_date, out_path)
    print(f"Saved prices to {saved_path}")


def command_run(args: argparse.Namespace) -> dict:
    symbol = validate_common(args.symbol, args.split_count, args.principal)
    csv_path = Path(args.csv) if args.csv else default_csv_path(symbol)
    compounding_type = "simple" if args.simple else "compound"
    prices = load_prices(csv_path, args.start_date, args.end_date)
    result = simulate(symbol, args.split_count, args.principal, compounding_type, prices)
    print_result(result)
    if args.json_out:
        out_path = Path(args.json_out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nSaved JSON result to {out_path}")
    return result


def command_all(args: argparse.Namespace) -> None:
    symbol = validate_common(args.symbol, args.split_count, args.principal)
    csv_path = Path(args.csv) if args.csv else default_csv_path(symbol)
    print(f"Downloading {symbol} prices...")
    saved_path = download_prices(symbol, args.start_date, args.end_date, csv_path)
    print(f"Saved prices to {saved_path}")
    if symbol != BENCHMARK_SYMBOL:
        print(f"Downloading {BENCHMARK_SYMBOL} prices...")
        qld_path = download_prices(BENCHMARK_SYMBOL, args.start_date, args.end_date, default_csv_path(BENCHMARK_SYMBOL))
        print(f"Saved prices to {qld_path}")
    time.sleep(0.2)
    command_run(args)


def buy_and_hold_result(principal: float, prices: list[Price]) -> dict:
    start_price = prices[0].close
    end_price = prices[-1].close
    ending_equity = round_money(principal * (end_price / start_price))
    profit_amount = round_money(ending_equity - principal)
    profit_rate = (profit_amount / principal) * 100 if principal > 0 else 0
    return {
        "ending_equity": ending_equity,
        "profit_amount": profit_amount,
        "profit_rate": profit_rate,
    }


def buy_and_hold_curve(principal: float, prices: list[Price]) -> list[dict]:
    if not prices:
        return []
    start_price = prices[0].close
    return [
        {
            "date": price.date,
            "equity": round_money(principal * (price.close / start_price)),
        }
        for price in prices
    ]


def filter_prices(prices: list[Price], start_date: str, end_date: str) -> list[Price]:
    return [price for price in prices if start_date <= price.date <= end_date]


def ensure_price_csv(symbol: str, start_date: str, end_date: str, csv_dir: Path) -> Path:
    symbol = validate_price_symbol(symbol)
    csv_path = csv_dir / f"{symbol}.csv"
    if not csv_path.exists():
        print(f"Downloading {symbol} prices...")
        download_prices(symbol, start_date, end_date, csv_path)
    return csv_path


def random_periods(prices: list[Price], count: int, min_days: int, max_days: int | None, seed: int | None) -> list[tuple[int, int]]:
    if count <= 0:
        raise ValueError("count must be positive")
    if min_days < 6:
        raise ValueError("min_days must be at least 6")

    total_days = len(prices)
    upper_days = min(max_days or total_days, total_days)
    if upper_days < min_days:
        raise ValueError("Not enough price rows for requested random period length")

    rng = random.Random(seed)
    periods = []
    for _ in range(count):
        length = rng.randint(min_days, upper_days)
        start_index = rng.randint(0, total_days - length)
        periods.append((start_index, start_index + length - 1))
    return periods


def print_random_comparison(result: dict) -> None:
    config = result["config"]
    print("\nRandom Period Comparison")
    print("========================")
    print(
        f"Samples: {config['count']} per symbol/split, principal {money(config['principal'])}, "
        f"period {config['start_date']} ~ {config['end_date']}"
    )
    print(f"Min/Max trading days: {config['min_days']} / {config['max_days'] or 'full range'}")

    print("\nDetails")
    print("symbol | split | sample | start      | end        | days | strategy | hold    | diff   | QLD     | QLD diff")
    print("-------|-------|--------|------------|------------|------|----------|---------|--------|---------|---------")
    for row in result["rows"]:
        print(
            f"{row['symbol']:<6} | {row['split_count']:>5} | {row['sample']:>6} | "
            f"{row['start_date']} | {row['end_date']} | {row['trading_days']:>4} | "
            f"{percent(row['strategy_profit_rate']):>8} | {percent(row['hold_profit_rate']):>7} | "
            f"{percent(row['diff_profit_rate']):>6} | {percent(row['qld_hold_profit_rate']):>7} | "
            f"{percent(row['qld_diff_profit_rate']):>8}"
        )

    print("\nSummary")
    print("symbol | split | avg strategy | avg hold | avg diff | hold wins | samples")
    print("-------|-------|--------------|----------|----------|-----------|--------")
    for item in result["summary"]:
        print(
            f"{item['symbol']:<6} | {item['split_count']:>5} | "
            f"{percent(item['avg_strategy_profit_rate']):>12} | {percent(item['avg_hold_profit_rate']):>8} | "
            f"{percent(item['avg_diff_profit_rate']):>8} | {item['strategy_win_count']:>9} | {item['sample_count']:>6}"
        )
    benchmark = result.get("benchmark_summary")
    if benchmark:
        print(
            f"{benchmark['symbol']:<6} | {'hold':>5} | {'-':>12} | "
            f"{percent(benchmark['avg_hold_profit_rate']):>8} | {'-':>8} | {'-':>9} | {benchmark['sample_count']:>6}"
        )


def signed_percent(value: float) -> str:
    return f"{value:+,.2f}%"


def html_class(value: float) -> str:
    return "positive" if value >= 0 else "negative"


def render_random_comparison_html(result: dict) -> str:
    config = result["config"]
    summary_cards = []
    for item in result["summary"]:
        win_rate = (item["strategy_win_count"] / item["sample_count"]) * 100 if item["sample_count"] else 0
        diff = item["avg_diff_profit_rate"]
        summary_cards.append(
            f"""
            <article class="card">
              <div class="card-head">
                <strong>{html.escape(item['symbol'])}</strong>
                <span>{item['split_count']} split</span>
              </div>
              <div class="metric {html_class(diff)}">{signed_percent(diff)}</div>
              <div class="sub">avg strategy {percent(item['avg_strategy_profit_rate'])} / hold {percent(item['avg_hold_profit_rate'])}</div>
              <div class="bar"><span style="width:{max(0, min(win_rate, 100)):.2f}%"></span></div>
              <div class="sub">wins {item['strategy_win_count']} / {item['sample_count']} ({win_rate:.1f}%)</div>
            </article>
            """
        )

    summary_rows = []
    for item in result["summary"]:
        win_rate = (item["strategy_win_count"] / item["sample_count"]) * 100 if item["sample_count"] else 0
        summary_rows.append(
            f"""
            <tr>
              <td>{html.escape(item['symbol'])}</td>
              <td>{item['split_count']}</td>
              <td class="{html_class(item['avg_strategy_profit_rate'])}">{percent(item['avg_strategy_profit_rate'])}</td>
              <td class="{html_class(item['avg_hold_profit_rate'])}">{percent(item['avg_hold_profit_rate'])}</td>
              <td class="{html_class(item['avg_diff_profit_rate'])}">{signed_percent(item['avg_diff_profit_rate'])}</td>
              <td>{item['strategy_win_count']} / {item['sample_count']}</td>
              <td>{win_rate:.1f}%</td>
            </tr>
            """
        )
    benchmark = result.get("benchmark_summary")
    if benchmark:
        summary_rows.append(
            f"""
            <tr class="benchmark">
              <td>{html.escape(benchmark['symbol'])}</td>
              <td>hold</td>
              <td>-</td>
              <td class="{html_class(benchmark['avg_hold_profit_rate'])}">{percent(benchmark['avg_hold_profit_rate'])}</td>
              <td>-</td>
              <td>-</td>
              <td>-</td>
            </tr>
            """
        )

    detail_rows = []
    for row in result["rows"]:
        detail_rows.append(
            f"""
            <tr>
              <td>{html.escape(row['symbol'])}</td>
              <td>{row['split_count']}</td>
              <td>{row['sample']}</td>
              <td>{row['start_date']}</td>
              <td>{row['end_date']}</td>
              <td>{row['trading_days']}</td>
              <td class="{html_class(row['strategy_profit_rate'])}">{percent(row['strategy_profit_rate'])}</td>
              <td class="{html_class(row['hold_profit_rate'])}">{percent(row['hold_profit_rate'])}</td>
              <td class="{html_class(row['diff_profit_rate'])}">{signed_percent(row['diff_profit_rate'])}</td>
              <td class="{html_class(row['qld_hold_profit_rate'])}">{percent(row['qld_hold_profit_rate'])}</td>
              <td class="{html_class(row['qld_diff_profit_rate'])}">{signed_percent(row['qld_diff_profit_rate'])}</td>
              <td>{money(row['strategy_ending_equity'])}</td>
              <td>{money(row['hold_ending_equity'])}</td>
              <td>{money(row['qld_hold_ending_equity'])}</td>
              <td>{row['completed_rounds']}</td>
              <td>{row['execution_count']}</td>
            </tr>
            """
        )

    generated_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return f"""<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Random Backtest Comparison</title>
  <style>
    :root {{
      --bg: #f7f4ef;
      --panel: #ffffff;
      --ink: #1f2933;
      --muted: #687385;
      --line: #ded7cb;
      --positive: #0f766e;
      --negative: #b42318;
      --accent: #245bdb;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      background: var(--bg);
      color: var(--ink);
      font-family: Arial, "Malgun Gothic", sans-serif;
      font-size: 14px;
    }}
    header {{
      padding: 24px 28px 14px;
      border-bottom: 1px solid var(--line);
      background: #fbfaf7;
      position: sticky;
      top: 0;
      z-index: 2;
    }}
    h1 {{ margin: 0 0 8px; font-size: 26px; }}
    .meta {{ color: var(--muted); display: flex; gap: 16px; flex-wrap: wrap; }}
    main {{ padding: 20px 28px 36px; }}
    .cards {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }}
    .card {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 14px;
    }}
    .card-head {{ display: flex; justify-content: space-between; color: var(--muted); }}
    .card-head strong {{ color: var(--ink); font-size: 18px; }}
    .metric {{ font-size: 30px; font-weight: 800; margin-top: 12px; }}
    .sub {{ color: var(--muted); margin-top: 6px; }}
    .bar {{ height: 8px; background: #e8edf3; border-radius: 999px; overflow: hidden; margin-top: 12px; }}
    .bar span {{ display: block; height: 100%; background: var(--accent); }}
    section {{ margin-top: 20px; }}
    h2 {{ margin: 0 0 10px; font-size: 18px; }}
    .table-wrap {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      overflow: auto;
    }}
    table {{ width: 100%; border-collapse: collapse; min-width: 980px; }}
    th, td {{ padding: 9px 10px; border-bottom: 1px solid #ece7df; text-align: right; white-space: nowrap; }}
    th {{ background: #f3efe7; color: #334155; }}
    td:first-child, th:first-child {{ text-align: left; }}
    tr:hover td {{ background: #faf7f0; }}
    tr.benchmark td {{ background: #f8fafc; font-weight: 700; }}
    .positive {{ color: var(--positive); font-weight: 700; }}
    .negative {{ color: var(--negative); font-weight: 700; }}
  </style>
</head>
<body>
  <header>
    <h1>Random Backtest Comparison</h1>
    <div class="meta">
      <span>Generated {generated_at}</span>
      <span>Samples {config['count']} per symbol/split</span>
      <span>Principal {money(config['principal'])}</span>
      <span>Period {config['start_date']} ~ {config['end_date']}</span>
      <span>Min/Max days {config['min_days']} / {config['max_days'] or 'full range'}</span>
      <span>{html.escape(config['compounding_type'])}</span>
    </div>
  </header>
  <main>
    <div class="cards">{''.join(summary_cards)}</div>
    <section>
      <h2>Summary</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Symbol</th><th>Split</th><th>Avg Strategy</th><th>Avg Hold</th><th>Avg Diff</th><th>Wins</th><th>Win Rate</th></tr>
          </thead>
          <tbody>{''.join(summary_rows)}</tbody>
        </table>
      </div>
    </section>
    <section>
      <h2>Samples</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Symbol</th><th>Split</th><th>Sample</th><th>Start</th><th>End</th><th>Days</th><th>Strategy</th><th>Hold</th><th>Diff</th><th>QLD</th><th>QLD Diff</th><th>Strategy Equity</th><th>Hold Equity</th><th>QLD Equity</th><th>Rounds</th><th>Executions</th></tr>
          </thead>
          <tbody>{''.join(detail_rows)}</tbody>
        </table>
      </div>
    </section>
  </main>
</body>
</html>"""


def write_random_html_report(result: dict, out_path: Path) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(render_random_comparison_html(result), encoding="utf-8")
    return out_path


def default_random_report_path(count: int, start_date: str, end_date: str) -> Path:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    safe_start = start_date.replace("-", "")
    safe_end = end_date.replace("-", "")
    filename = f"random-compare-n{count}-{safe_start}-{safe_end}-{timestamp}.html"
    return ROOT / "results" / filename


def print_progress_bar(completed: int, total: int) -> None:
    ratio = completed / total if total else 1
    percent_done = math.floor(ratio * 100)
    bar_width = 30
    filled = min(bar_width, math.floor(ratio * bar_width))
    bar = "#" * filled + "-" * (bar_width - filled)
    print(f"\rRunning [{bar}] {percent_done:3d}% ({completed}/{total})", end="", flush=True)


def command_random(args: argparse.Namespace) -> dict:
    symbols = [validate_common(symbol) for symbol in args.symbols]
    splits = args.splits
    for split_count in splits:
        validate_common("TQQQ", split_count, args.principal)

    compounding_type = "simple" if args.simple else "compound"
    csv_dir = Path(args.csv_dir) if args.csv_dir else ROOT / "data"
    qld_csv_path = ensure_price_csv(BENCHMARK_SYMBOL, args.start_date, args.end_date, csv_dir)
    qld_prices = load_prices(qld_csv_path, args.start_date, args.end_date)
    periods = random_periods(qld_prices, args.count, args.min_days, args.max_days, args.seed)
    period_ranges = []
    for sample_index, (start_index, end_index) in enumerate(periods, start=1):
        qld_period_prices = qld_prices[start_index : end_index + 1]
        qld_hold_result = buy_and_hold_result(args.principal, qld_period_prices)
        period_ranges.append(
            {
                "sample": sample_index,
                "start_date": qld_period_prices[0].date,
                "end_date": qld_period_prices[-1].date,
                "trading_days": len(qld_period_prices),
                "qld_hold_profit_rate": qld_hold_result["profit_rate"],
                "qld_hold_ending_equity": qld_hold_result["ending_equity"],
            }
        )

    rows = []
    total_runs = len(symbols) * len(splits) * args.count
    completed_runs = 0
    show_progress = not getattr(args, "no_progress", False)

    if show_progress:
        print_progress_bar(0, total_runs)

    for symbol in symbols:
        prices = load_prices(csv_dir / f"{symbol}.csv", args.start_date, args.end_date)

        for split_count in splits:
            for period in period_ranges:
                period_prices = filter_prices(prices, period["start_date"], period["end_date"])
                if len(period_prices) < 6:
                    raise RuntimeError(f"Not enough {symbol} rows for {period['start_date']} ~ {period['end_date']}")
                strategy_result = simulate(symbol, split_count, args.principal, compounding_type, period_prices)
                hold_result = buy_and_hold_result(args.principal, period_prices)
                strategy_rate = strategy_result["summary"]["profit_rate"]
                hold_rate = hold_result["profit_rate"]
                qld_hold_rate = period["qld_hold_profit_rate"]
                rows.append(
                    {
                        "symbol": symbol,
                        "split_count": split_count,
                        "sample": period["sample"],
                        "start_date": period["start_date"],
                        "end_date": period["end_date"],
                        "trading_days": len(period_prices),
                        "strategy_profit_rate": strategy_rate,
                        "hold_profit_rate": hold_rate,
                        "diff_profit_rate": strategy_rate - hold_rate,
                        "qld_hold_profit_rate": qld_hold_rate,
                        "qld_diff_profit_rate": strategy_rate - qld_hold_rate,
                        "strategy_ending_equity": strategy_result["summary"]["ending_equity"],
                        "hold_ending_equity": hold_result["ending_equity"],
                        "qld_hold_ending_equity": period["qld_hold_ending_equity"],
                        "completed_rounds": strategy_result["summary"]["completed_rounds"],
                        "execution_count": strategy_result["summary"]["execution_count"],
                    }
                )
                completed_runs += 1
                if show_progress:
                    print_progress_bar(completed_runs, total_runs)

    if show_progress:
        print()

    summary = []
    for symbol in symbols:
        for split_count in splits:
            group = [row for row in rows if row["symbol"] == symbol and row["split_count"] == split_count]
            if not group:
                continue
            sample_count = len(group)
            summary.append(
                {
                    "symbol": symbol,
                    "split_count": split_count,
                    "sample_count": sample_count,
                    "avg_strategy_profit_rate": sum(row["strategy_profit_rate"] for row in group) / sample_count,
                    "avg_hold_profit_rate": sum(row["hold_profit_rate"] for row in group) / sample_count,
                    "avg_diff_profit_rate": sum(row["diff_profit_rate"] for row in group) / sample_count,
                    "strategy_win_count": sum(1 for row in group if row["strategy_profit_rate"] > row["hold_profit_rate"]),
                }
            )

    benchmark_summary = {
        "symbol": BENCHMARK_SYMBOL,
        "sample_count": len(period_ranges),
        "avg_hold_profit_rate": sum(period["qld_hold_profit_rate"] for period in period_ranges) / len(period_ranges),
        "avg_ending_equity": sum(period["qld_hold_ending_equity"] for period in period_ranges) / len(period_ranges),
    }

    result = {
        "config": {
            "symbols": symbols,
            "splits": splits,
            "count": args.count,
            "principal": args.principal,
            "start_date": args.start_date,
            "end_date": args.end_date,
            "min_days": args.min_days,
            "max_days": args.max_days,
            "seed": args.seed,
            "compounding_type": compounding_type,
            "csv_dir": str(csv_dir),
            "benchmark_symbol": BENCHMARK_SYMBOL,
        },
        "summary": summary,
        "benchmark_summary": benchmark_summary,
        "rows": rows,
    }

    if getattr(args, "print_console", True) and not getattr(args, "no_console", False):
        print_random_comparison(result)
    else:
        print(
            f"\nRandom comparison complete: {len(rows)} samples, "
            f"{len(summary)} symbol/split summaries"
        )
    if args.json_out:
        out_path = Path(args.json_out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\nSaved JSON result to {out_path}")
    if args.html_out:
        html_path = (
            default_random_report_path(args.count, args.start_date, args.end_date)
            if args.html_out == "auto"
            else Path(args.html_out)
        )
        html_path = write_random_html_report(result, html_path)
        print(f"\nSaved HTML report to {html_path}")
        if args.open_html and not getattr(args, "no_open_html", False):
            webbrowser.open(html_path.resolve().as_uri())
    return result


def prompt_text(label: str, default: str | None = None, required: bool = True) -> str:
    suffix = f" [{default}]" if default not in (None, "") else ""
    while True:
        value = input(f"{label}{suffix}: ").strip()
        if not value and default is not None:
            return default
        if value or not required:
            return value
        print("값을 입력해 주세요.")


def prompt_choice(title: str, choices: list[tuple[str, str]]) -> str:
    print(f"\n{title}")
    for key, label in choices:
        print(f"  {key}. {label}")
    valid_keys = {key for key, _ in choices}
    while True:
        value = input("선택: ").strip()
        if value in valid_keys:
            return value
        print("목록에 있는 번호를 입력해 주세요.")


def prompt_yes_no(label: str, default: bool = False) -> bool:
    hint = "Y/n" if default else "y/N"
    while True:
        value = input(f"{label} [{hint}]: ").strip().lower()
        if not value:
            return default
        if value in {"y", "yes"}:
            return True
        if value in {"n", "no"}:
            return False
        print("y 또는 n으로 입력해 주세요.")


def prompt_int(label: str, default: int | None = None, allowed: set[int] | None = None, minimum: int | None = None) -> int:
    while True:
        raw = prompt_text(label, str(default) if default is not None else None)
        try:
            value = int(raw)
        except ValueError:
            print("숫자로 입력해 주세요.")
            continue
        if allowed is not None and value not in allowed:
            print(f"가능한 값: {', '.join(str(item) for item in sorted(allowed))}")
            continue
        if minimum is not None and value < minimum:
            print(f"{minimum} 이상으로 입력해 주세요.")
            continue
        return value


def prompt_float(label: str, default: float | None = None, minimum: float | None = None) -> float:
    while True:
        raw = prompt_text(label, str(default) if default is not None else None)
        try:
            value = float(raw)
        except ValueError:
            print("숫자로 입력해 주세요.")
            continue
        if minimum is not None and value < minimum:
            print(f"{minimum:g} 이상으로 입력해 주세요.")
            continue
        return value


def prompt_date(label: str, default: str) -> str:
    while True:
        value = prompt_text(label, default)
        try:
            return parse_yyyy_mm_dd(value, label)
        except ValueError as error:
            print(error)


def prompt_symbol(default: str = "SOXL") -> str:
    choice = prompt_choice(
        "종목 선택",
        [
            ("1", "SOXL"),
            ("2", "TQQQ"),
        ],
    )
    return "SOXL" if choice == "1" else "TQQQ"


def prompt_price_symbol() -> str:
    choice = prompt_choice(
        "가격 다운로드 종목",
        [
            ("1", "SOXL"),
            ("2", "TQQQ"),
            ("3", "QLD"),
        ],
    )
    return {"1": "SOXL", "2": "TQQQ", "3": "QLD"}[choice]


def prompt_symbols(default_both: bool = True) -> list[str]:
    choice = prompt_choice(
        "비교할 종목",
        [
            ("1", "TQQQ + SOXL"),
            ("2", "SOXL만"),
            ("3", "TQQQ만"),
        ],
    )
    if choice == "2":
        return ["SOXL"]
    if choice == "3":
        return ["TQQQ"]
    return ["TQQQ", "SOXL"] if default_both else ["SOXL"]


def prompt_splits(single: bool) -> int | list[int]:
    if single:
        choice = prompt_choice(
            "분할 수",
            [
                ("1", "40분할"),
                ("2", "30분할"),
                ("3", "20분할"),
            ],
        )
        return {"1": 40, "2": 30, "3": 20}[choice]

    choice = prompt_choice(
        "비교할 분할 수",
        [
            ("1", "40, 30, 20 전체"),
            ("2", "40분할만"),
            ("3", "30분할만"),
            ("4", "20분할만"),
        ],
    )
    return {"1": [40, 30, 20], "2": [40], "3": [30], "4": [20]}[choice]


def prompt_common_run_args(mode: str) -> argparse.Namespace:
    symbol = prompt_symbol()
    split_count = prompt_splits(single=True)
    principal = prompt_float("원금($)", 20000, minimum=0.01)
    start_date = prompt_date("시작일", "2020-01-01")
    end_date = prompt_date("종료일", datetime.now().strftime("%Y-%m-%d"))
    simple = prompt_yes_no("단리로 실행할까요?", False)
    default_csv = str(default_csv_path(symbol))
    csv = prompt_text("가격 CSV 경로", default_csv, required=False)
    json_out = prompt_text("결과 JSON 저장 경로(엔터=저장 안 함)", "", required=False)
    return argparse.Namespace(
        command=mode,
        symbol=symbol,
        split_count=split_count,
        principal=principal,
        start_date=start_date,
        end_date=end_date,
        simple=simple,
        csv=csv or None,
        json_out=json_out or None,
    )


def prompt_download_args() -> argparse.Namespace:
    symbol = prompt_price_symbol()
    start_date = prompt_date("시작일", "2020-01-01")
    end_date = prompt_date("종료일", datetime.now().strftime("%Y-%m-%d"))
    out = prompt_text("저장할 CSV 경로", str(default_csv_path(symbol)), required=False)
    return argparse.Namespace(command="download", symbol=symbol, start_date=start_date, end_date=end_date, out=out or None)


def prompt_random_args(report_mode: bool) -> argparse.Namespace:
    symbols = prompt_symbols()
    splits = prompt_splits(single=False)
    count = prompt_int("종목/분할별 랜덤 샘플 수", 100, minimum=1)
    principal = prompt_float("원금($)", 20000, minimum=0.01)
    start_date = prompt_date("랜덤 기간 검색 시작일", "2020-01-01")
    end_date = prompt_date("랜덤 기간 검색 종료일", datetime.now().strftime("%Y-%m-%d"))
    min_days = prompt_int("최소 거래일 수", 60, minimum=6)
    max_days_text = prompt_text("최대 거래일 수(엔터=전체 범위)", "", required=False)
    while True:
        try:
            max_days = int(max_days_text) if max_days_text else None
        except ValueError:
            print("숫자로 입력해 주세요.")
            max_days_text = prompt_text("최대 거래일 수(엔터=전체 범위)", "", required=False)
            continue
        if max_days is not None and max_days < min_days:
            print("최대 거래일 수는 최소 거래일 수보다 크거나 같아야 합니다.")
            max_days_text = prompt_text("최대 거래일 수(엔터=전체 범위)", "", required=False)
            continue
        break

    seed_text = prompt_text("랜덤 시드(엔터=매번 랜덤)", "", required=False)
    while True:
        try:
            seed = int(seed_text) if seed_text else None
            break
        except ValueError:
            print("숫자로 입력해 주세요.")
            seed_text = prompt_text("랜덤 시드(엔터=매번 랜덤)", "", required=False)

    simple = prompt_yes_no("단리로 실행할까요?", False)
    csv_dir = prompt_text("가격 CSV 폴더", str(ROOT / "data"), required=False)
    json_out = prompt_text("결과 JSON 저장 경로(엔터=저장 안 함)", "", required=False)

    if report_mode:
        html_out = "auto"
        open_html = prompt_yes_no("HTML 리포트를 자동으로 열까요?", True)
        no_console = True
        print_console = False
    else:
        save_html = prompt_yes_no("HTML 리포트도 저장할까요?", False)
        html_out = "auto" if save_html else None
        open_html = save_html and prompt_yes_no("HTML 리포트를 자동으로 열까요?", True)
        no_console = not prompt_yes_no("상세 표를 터미널에 출력할까요?", count <= 20)
        print_console = not no_console

    return argparse.Namespace(
        command="report" if report_mode else "rand",
        symbols=symbols,
        splits=splits,
        count=count,
        principal=principal,
        start_date=start_date,
        end_date=end_date,
        min_days=min_days,
        max_days=max_days,
        seed=seed,
        csv_dir=csv_dir or None,
        simple=simple,
        json_out=json_out or None,
        html_out=html_out,
        open_html=open_html,
        no_open_html=not open_html,
        no_console=no_console,
        no_progress=False,
        print_console=print_console,
    )


def run_interactive() -> None:
    print("\nTQQQ/SOXL BackTest TUI")
    print("======================")
    while True:
        choice = prompt_choice(
            "실행할 작업",
            [
                ("1", "다운로드 + 백테스트 실행"),
                ("2", "CSV로 백테스트 실행"),
                ("3", "가격 다운로드만"),
                ("4", "랜덤 기간 비교"),
                ("5", "HTML 랜덤 비교 리포트"),
                ("6", "명령어 도움말 보기"),
                ("0", "종료"),
            ],
        )

        if choice == "0":
            print("종료합니다.")
            return
        if choice == "6":
            build_parser().print_help()
        else:
            try:
                if choice == "1":
                    command_all(prompt_common_run_args("all"))
                elif choice == "2":
                    command_run(prompt_common_run_args("run"))
                elif choice == "3":
                    command_download(prompt_download_args())
                elif choice == "4":
                    command_random(prompt_random_args(report_mode=False))
                elif choice == "5":
                    command_random(prompt_random_args(report_mode=True))
            except KeyboardInterrupt:
                print("\n작업을 취소했습니다.")
            except Exception as error:
                print(f"\nError: {error}", file=sys.stderr)

        if not prompt_yes_no("\n다른 작업을 계속할까요?", False):
            print("종료합니다.")
            return


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="TQQQ/SOXL backtest helper")
    subparsers = parser.add_subparsers(dest="command", required=True)

    download = subparsers.add_parser("download", help="download Yahoo daily prices to CSV")
    download.add_argument("symbol", help="TQQQ, SOXL, or QLD")
    download.add_argument("start_date", type=lambda value: parse_yyyy_mm_dd(value, "start_date"))
    download.add_argument("end_date", type=lambda value: parse_yyyy_mm_dd(value, "end_date"))
    download.add_argument("--out", help="output CSV path")
    download.set_defaults(func=command_download)

    def add_run_args(target: argparse.ArgumentParser) -> None:
        target.add_argument("symbol", help="TQQQ or SOXL")
        target.add_argument("split_count", type=int, help="20, 30, or 40")
        target.add_argument("principal", type=float, help="starting principal in dollars")
        target.add_argument("start_date", type=lambda value: parse_yyyy_mm_dd(value, "start_date"))
        target.add_argument("end_date", type=lambda value: parse_yyyy_mm_dd(value, "end_date"))
        target.add_argument("--simple", action="store_true", help="restart each round with original principal")
        target.add_argument("--csv", help="price CSV path")
        target.add_argument("--json-out", help="save full result JSON")

    run = subparsers.add_parser("run", help="run backtest from an existing CSV")
    add_run_args(run)
    run.set_defaults(func=command_run)

    all_command = subparsers.add_parser("all", help="download prices then run backtest")
    add_run_args(all_command)
    all_command.set_defaults(func=command_all)

    def add_random_args(target: argparse.ArgumentParser, html_default: str | None = None, open_default: bool = False, print_default: bool = True) -> None:
        target.add_argument("--count", "-n", type=int, default=100, help="random period count per symbol/split")
        target.add_argument("--principal", "-p", type=float, default=20000, help="starting principal in dollars")
        target.add_argument("--start-date", "--range-start", dest="start_date", default="2020-01-01", type=lambda value: parse_yyyy_mm_dd(value, "start_date"), help="random period search range start date")
        target.add_argument("--end-date", "--range-end", dest="end_date", default=datetime.now().strftime("%Y-%m-%d"), type=lambda value: parse_yyyy_mm_dd(value, "end_date"), help="random period search range end date")
        target.add_argument("--symbols", nargs="+", default=["TQQQ", "SOXL"], help="symbols to compare")
        target.add_argument("--splits", nargs="+", type=int, default=[40, 30, 20], help="split counts to compare")
        target.add_argument("--min-days", type=int, default=60, help="minimum random period length in trading days")
        target.add_argument("--max-days", type=int, default=None, help="maximum random period length in trading days")
        target.add_argument("--seed", type=int, default=None, help="random seed for repeatable samples")
        target.add_argument("--csv-dir", help="directory containing TQQQ.csv and SOXL.csv")
        target.add_argument("--simple", action="store_true", help="restart each round with original principal")
        target.add_argument("--json-out", help="save comparison result JSON")
        target.add_argument("--html-out", default=html_default, help="save comparison result HTML")
        target.add_argument("--open-html", action="store_true", default=open_default, help="open HTML report after saving")
        target.add_argument("--no-open-html", action="store_true", help="do not open HTML report after saving")
        target.add_argument("--no-console", action="store_true", help="skip detailed console table")
        target.add_argument("--no-progress", action="store_true", help="skip progress output")
        target.set_defaults(func=command_random, print_console=print_default)

    random_command = subparsers.add_parser("random", help="compare strategy vs buy-and-hold on random periods")
    add_random_args(random_command)

    rand_command = subparsers.add_parser("rand", help="short alias for random")
    add_random_args(rand_command)

    report_command = subparsers.add_parser("report", help="create and open an HTML random comparison report")
    add_random_args(report_command, "auto", True, False)

    return parser


def main() -> None:
    if len(sys.argv) == 1:
        try:
            run_interactive()
        except KeyboardInterrupt:
            print("\n종료합니다.")
        return

    parser = build_parser()
    args = parser.parse_args()
    try:
        args.func(args)
    except Exception as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
