#!/usr/bin/env python3

import argparse
import csv
import json
import math
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parent
VALID_SYMBOLS = {"TQQQ", "SOXL"}
VALID_SPLITS = {20, 40}


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
    if symbol not in VALID_SYMBOLS:
        raise ValueError("Only TQQQ and SOXL are supported")

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
    if symbol == "TQQQ" and split_count == 20:
        return (15 - 1.5 * t_value) / 100
    if symbol == "TQQQ" and split_count == 40:
        return (15 - 0.75 * t_value) / 100
    if split_count == 20:
        return (20 - 2 * t_value) / 100
    return (20 - t_value) / 100


def apply_t_effect(t_value: float, effect: str, split_count: int) -> float:
    if effect == "buy_full":
        return round_t(t_value + 1)
    if effect == "buy_half":
        return round_t(t_value + 0.5)
    if effect == "quarter_sell":
        return round_t(t_value * 0.75)
    if effect == "reverse_sell":
        return round_t(t_value * (0.9 if split_count == 20 else 0.95))
    if effect == "reverse_buy":
        return round_t(t_value + (split_count - t_value) * 0.25)
    return round_t(t_value)


def can_fill_at_price(day: Price, price: float) -> bool:
    return price > 0 and day.low <= price <= day.high


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
    if order_type == "LOC" and not can_fill_at_price(day, price):
        return False

    spendable = min(budget, state.cash_balance)
    quantity = floor_shares(spendable / price)
    if quantity <= 0:
        return False

    amount = round_money(quantity * price)
    previous_cost = state.avg_price * state.position_qty
    state.cash_balance = round_money(state.cash_balance - amount)
    state.position_qty += quantity
    state.avg_price = round_price((previous_cost + amount) / state.position_qty)
    state.t_value = apply_t_effect(state.t_value, t_effect, state.split_count)
    record_execution(executions, state, day, "buy", order_type, label, price, quantity, t_effect)
    return True


def sell(state: State, executions: list[Execution], day: Price, label: str, order_type: str, price: float, quantity: int, t_effect: str) -> bool:
    sell_qty = min(quantity, state.position_qty)
    if sell_qty <= 0:
        return False
    if order_type == "LIMIT" and day.high < price:
        return False
    if order_type == "LOC" and not can_fill_at_price(day, price):
        return False

    state.cash_balance = round_money(state.cash_balance + sell_qty * price)
    state.position_qty -= sell_qty
    state.t_value = apply_t_effect(state.t_value, t_effect, state.split_count)
    if state.position_qty == 0:
        state.avg_price = 0
    record_execution(executions, state, day, "sell", order_type, label, price, sell_qty, t_effect)
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


def start_next_round_if_needed(state: State, executions: list[Execution], day: Price) -> None:
    if state.position_qty != 0 or state.t_value != 0:
        return

    one_unit_budget = round_money(state.principal / state.split_count)
    quantity = floor_shares(min(one_unit_budget, state.cash_balance) / day.close)
    if quantity <= 0:
        return

    amount = round_money(quantity * day.close)
    state.cash_balance = round_money(state.cash_balance - amount)
    state.position_qty = quantity
    state.avg_price = day.close
    state.t_value = 1
    state.round_started_at = day.date
    record_execution(executions, state, day, "buy", "MOC", "new round first buy", day.close, quantity, "buy_full")


def process_normal_day(state: State, executions: list[Execution], rounds: list[RoundResult], day: Price) -> None:
    if state.t_value > state.split_count - 1:
        state.mode = "reverse"
        state.reverse_first_sell_done = False
        return

    avg_price_for_plan = state.avg_price
    star_percent = calculate_star_percent(state.symbol, state.split_count, state.t_value)
    star_price = round_price(avg_price_for_plan * (1 + star_percent))
    buy_price = round_price(star_price - 0.01)
    target_sell_price = round_price(avg_price_for_plan * (1.15 if state.symbol == "TQQQ" else 1.2))
    one_unit_budget = round_money(state.cash_balance / max(state.split_count - state.t_value, 1))

    sell(state, executions, day, "quarter sell", "LOC", star_price, floor_shares(state.position_qty / 4), "quarter_sell")
    final_sold = sell(state, executions, day, "final limit sell", "LIMIT", target_sell_price, state.position_qty, "none")
    if final_sold and state.position_qty == 0:
        complete_round(state, rounds, executions, day)
        return

    if state.t_value < state.split_count / 2:
        half_budget = round_money(one_unit_budget / 2)
        buy(state, executions, day, "first half star buy", buy_price, half_budget, "buy_half")
        buy(state, executions, day, "first half avg buy", round_price(avg_price_for_plan), half_budget, "buy_half")
    else:
        buy(state, executions, day, "second half star buy", buy_price, one_unit_budget, "buy_full")


def process_reverse_day(state: State, executions: list[Execution], day: Price, previous_closes: list[float]) -> None:
    sell_qty = floor_shares(state.position_qty / (10 if state.split_count == 20 else 20))
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
        start_next_round_if_needed(state, executions, day)

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
        raise ValueError("Only TQQQ and SOXL are supported")
    if split_count is not None and split_count not in VALID_SPLITS:
        raise ValueError("split_count must be 20 or 40")
    if principal is not None and principal <= 0:
        raise ValueError("principal must be positive")
    return symbol


def command_download(args: argparse.Namespace) -> None:
    symbol = validate_common(args.symbol)
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
    time.sleep(0.2)
    command_run(args)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="TQQQ/SOXL backtest helper")
    subparsers = parser.add_subparsers(dest="command", required=True)

    download = subparsers.add_parser("download", help="download Yahoo daily prices to CSV")
    download.add_argument("symbol", help="TQQQ or SOXL")
    download.add_argument("start_date", type=lambda value: parse_yyyy_mm_dd(value, "start_date"))
    download.add_argument("end_date", type=lambda value: parse_yyyy_mm_dd(value, "end_date"))
    download.add_argument("--out", help="output CSV path")
    download.set_defaults(func=command_download)

    def add_run_args(target: argparse.ArgumentParser) -> None:
        target.add_argument("symbol", help="TQQQ or SOXL")
        target.add_argument("split_count", type=int, help="20 or 40")
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

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    try:
        args.func(args)
    except Exception as error:
        print(f"Error: {error}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
