#!/usr/bin/env python3

import contextlib
import io
import sys
import traceback
from dataclasses import dataclass
from datetime import date
from pathlib import Path

try:
    from PyQt6.QtCore import QPointF, Qt, QThread, QObject, pyqtSignal
    from PyQt6.QtGui import QColor, QFont, QPainter, QPen, QPolygonF
    from PyQt6.QtWidgets import (
        QApplication,
        QCheckBox,
        QComboBox,
        QFileDialog,
        QFormLayout,
        QGridLayout,
        QGroupBox,
        QHBoxLayout,
        QLabel,
        QLineEdit,
        QMainWindow,
        QMessageBox,
        QPushButton,
        QSplitter,
        QTextEdit,
        QVBoxLayout,
        QWidget,
    )
except ImportError:
    print("PyQt6가 필요합니다. 아래 명령으로 설치하세요:")
    print("python3 -m pip install PyQt6")
    raise

from backtest import BENCHMARK_SYMBOL, buy_and_hold_curve, default_csv_path, download_prices, filter_prices, load_prices, print_result, simulate


@dataclass
class Job:
    mode: str
    symbol: str
    split_count: int
    principal: float
    start_date: str
    end_date: str
    compounding_type: str
    csv_path: Path
    json_path: Path | None


class BacktestWorker(QObject):
    finished = pyqtSignal(str, object)
    failed = pyqtSignal(str)

    def __init__(self, job: Job):
        super().__init__()
        self.job = job

    def run(self) -> None:
        try:
            output = io.StringIO()
            chart_payload = {"series": []}
            with contextlib.redirect_stdout(output):
                if self.job.mode in {"download", "all"}:
                    print(f"Downloading {self.job.symbol} prices...")
                    saved_path = download_prices(
                        self.job.symbol,
                        self.job.start_date,
                        self.job.end_date,
                        self.job.csv_path,
                    )
                    print(f"Saved prices to {saved_path}\n")
                    if self.job.symbol != BENCHMARK_SYMBOL:
                        print(f"Downloading {BENCHMARK_SYMBOL} prices...")
                        qld_path = download_prices(
                            BENCHMARK_SYMBOL,
                            self.job.start_date,
                            self.job.end_date,
                            default_csv_path(BENCHMARK_SYMBOL),
                        )
                        print(f"Saved prices to {qld_path}\n")

                if self.job.mode in {"run", "all"}:
                    prices = load_prices(self.job.csv_path, self.job.start_date, self.job.end_date)
                    result = simulate(
                        self.job.symbol,
                        self.job.split_count,
                        self.job.principal,
                        self.job.compounding_type,
                        prices,
                    )
                    strategy_points = [
                        (point["date"], point["equity"]) for point in result.get("equity_curve", [])
                    ]
                    hold_points = [
                        (point["date"], point["equity"]) for point in buy_and_hold_curve(self.job.principal, prices)
                    ]
                    chart_payload["series"] = [
                        {"label": f"{self.job.symbol} 전략", "color": "#2563eb", "points": strategy_points},
                        {"label": f"{self.job.symbol} 거치식", "color": "#0f766e", "points": hold_points},
                    ]

                    qld_csv_path = default_csv_path(BENCHMARK_SYMBOL)
                    if not qld_csv_path.exists():
                        print(f"Downloading {BENCHMARK_SYMBOL} prices...")
                        qld_csv_path = download_prices(BENCHMARK_SYMBOL, self.job.start_date, self.job.end_date, qld_csv_path)
                        print(f"Saved prices to {qld_csv_path}\n")
                    qld_prices = filter_prices(load_prices(qld_csv_path, self.job.start_date, self.job.end_date), prices[0].date, prices[-1].date)
                    if len(qld_prices) >= 2:
                        qld_points = [
                            (point["date"], point["equity"]) for point in buy_and_hold_curve(self.job.principal, qld_prices)
                        ]
                        chart_payload["series"].append({"label": f"{BENCHMARK_SYMBOL} 거치식", "color": "#c2410c", "points": qld_points})
                    else:
                        print(f"{BENCHMARK_SYMBOL} 가격 데이터가 부족해서 거치식 그래프는 생략했습니다.\n")

                    print_result(result)

                    if self.job.json_path:
                        import json

                        self.job.json_path.parent.mkdir(parents=True, exist_ok=True)
                        self.job.json_path.write_text(
                            json.dumps(result, ensure_ascii=False, indent=2),
                            encoding="utf-8",
                        )
                        print(f"\nSaved JSON result to {self.job.json_path}")

            self.finished.emit(output.getvalue(), chart_payload)
        except Exception:
            self.failed.emit(traceback.format_exc())


class CloseChartWidget(QWidget):
    def __init__(self, title: str = "종가 차트", empty_text: str = "백테스트를 실행하면 차트가 표시됩니다.", line_color: str = "#1c6b4f"):
        super().__init__()
        self.title = title
        self.empty_text = empty_text
        self.line_color = line_color
        self.points: list[tuple[str, float]] = []
        self.series: list[dict] = []
        self.setMinimumHeight(360)

    def set_points(self, points: list[tuple[str, float]]) -> None:
        self.points = points
        self.series = [{"label": self.title, "color": self.line_color, "points": points}]
        self.update()

    def set_series(self, series: list[dict]) -> None:
        self.series = series
        self.points = series[0].get("points", []) if series else []
        self.update()

    def paintEvent(self, event) -> None:
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        rect = self.rect().adjusted(14, 14, -14, -14)
        painter.fillRect(self.rect(), QColor("#fffaf2"))

        painter.setPen(QPen(QColor("#e3d8c6"), 1))
        painter.drawRoundedRect(rect, 14, 14)

        non_empty_series = [item for item in self.series if item.get("points")]
        if not non_empty_series:
            painter.setPen(QColor("#756b5d"))
            painter.setFont(QFont("Arial", 12))
            painter.drawText(rect, Qt.AlignmentFlag.AlignCenter, self.empty_text)
            return

        prices = [price for item in non_empty_series for _, price in item.get("points", [])]
        min_price = min(prices)
        max_price = max(prices)
        if min_price == max_price:
            min_price *= 0.99
            max_price *= 1.01

        chart = rect.adjusted(72, 54, -18, -48)
        painter.setPen(QPen(QColor("#e3d8c6"), 1))
        for index in range(5):
            y = chart.top() + chart.height() * index / 4
            painter.drawLine(chart.left(), int(y), chart.right(), int(y))

        for item in non_empty_series:
            points = item.get("points", [])
            polygon = QPolygonF()
            for index, (_, price) in enumerate(points):
                x = chart.left() if len(points) == 1 else chart.left() + chart.width() * index / (len(points) - 1)
                y = chart.bottom() - (price - min_price) / (max_price - min_price) * chart.height()
                polygon.append(QPointF(x, y))

            painter.setPen(QPen(QColor(item.get("color", self.line_color)), 2.4))
            painter.drawPolyline(polygon)

        first_points = non_empty_series[0].get("points", [])
        first_date = first_points[0][0]
        last_date = first_points[-1][0]

        painter.setPen(QColor("#1e1a14"))
        painter.setFont(QFont("Arial", 12, QFont.Weight.Bold))
        painter.drawText(rect.adjusted(16, 8, -16, -8), Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignLeft, self.title)

        legend_x = rect.left() + 16
        legend_y = rect.top() + 34
        painter.setFont(QFont("Arial", 10))
        for item in non_empty_series:
            points = item.get("points", [])
            if not points:
                continue
            start_value = points[0][1]
            end_value = points[-1][1]
            change_rate = ((end_value - start_value) / start_value) * 100 if start_value else 0
            painter.setPen(QPen(QColor(item.get("color", self.line_color)), 3))
            painter.drawLine(legend_x, legend_y + 6, legend_x + 18, legend_y + 6)
            painter.setPen(QColor("#1e1a14"))
            painter.drawText(legend_x + 24, legend_y + 11, f"{item.get('label', '')} {end_value:,.2f} ({change_rate:+.2f}%)")
            legend_x += 230

        painter.setPen(QColor("#756b5d"))
        painter.setFont(QFont("Arial", 10))
        painter.drawText(rect.adjusted(16, 8, -16, -8), Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignRight, f"{first_date} ~ {last_date}")
        painter.drawText(chart.left(), chart.bottom() + 24, 80, 20, Qt.AlignmentFlag.AlignLeft.value, first_date[5:])
        painter.drawText(chart.right() - 80, chart.bottom() + 24, 80, 20, Qt.AlignmentFlag.AlignRight.value, last_date[5:])

        painter.setPen(QColor("#756b5d"))
        painter.drawText(18, chart.top() + 5, f"{max_price:,.0f}")
        painter.drawText(18, chart.bottom(), f"{min_price:,.0f}")


class BacktestWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.thread: QThread | None = None
        self.worker: BacktestWorker | None = None
        self.setWindowTitle("TQQQ/SOXL 백테스트")
        self.resize(1380, 840)

        root = QWidget()
        layout = QVBoxLayout(root)

        title = QLabel("TQQQ / SOXL 백테스트")
        title.setStyleSheet("font-size: 24px; font-weight: 800; margin-bottom: 8px;")
        layout.addWidget(title)

        splitter = QSplitter(Qt.Orientation.Horizontal)
        layout.addWidget(splitter, 1)

        left_column = QWidget()
        left_layout = QVBoxLayout(left_column)
        left_layout.setContentsMargins(0, 0, 0, 0)
        left_layout.setSpacing(10)

        form_group = QGroupBox("설정")
        form_layout = QFormLayout(form_group)

        self.symbol = QComboBox()
        self.symbol.addItems(["TQQQ", "SOXL"])
        self.symbol.currentTextChanged.connect(self.update_default_csv_path)
        form_layout.addRow("종목", self.symbol)

        self.split_count = QComboBox()
        self.split_count.addItems(["40", "30", "20"])
        form_layout.addRow("분할 수", self.split_count)

        self.principal = QLineEdit("20000")
        form_layout.addRow("원금($)", self.principal)

        date_row = QWidget()
        date_layout = QHBoxLayout(date_row)
        date_layout.setContentsMargins(0, 0, 0, 0)
        self.start_date = QLineEdit("2020-01-01")
        self.end_date = QLineEdit(date.today().isoformat())
        date_layout.addWidget(QLabel("시작"))
        date_layout.addWidget(self.start_date)
        date_layout.addWidget(QLabel("종료"))
        date_layout.addWidget(self.end_date)
        form_layout.addRow("기간", date_row)

        self.simple = QCheckBox("단리로 실행")
        form_layout.addRow("복리/단리", self.simple)

        csv_row = QWidget()
        csv_layout = QHBoxLayout(csv_row)
        csv_layout.setContentsMargins(0, 0, 0, 0)
        self.csv_path = QLineEdit()
        csv_button = QPushButton("찾기")
        csv_button.clicked.connect(self.choose_csv)
        csv_layout.addWidget(self.csv_path)
        csv_layout.addWidget(csv_button)
        form_layout.addRow("가격 CSV", csv_row)

        json_row = QWidget()
        json_layout = QHBoxLayout(json_row)
        json_layout.setContentsMargins(0, 0, 0, 0)
        self.json_path = QLineEdit()
        json_button = QPushButton("저장 위치")
        json_button.clicked.connect(self.choose_json)
        json_layout.addWidget(self.json_path)
        json_layout.addWidget(json_button)
        form_layout.addRow("결과 JSON(선택)", json_row)

        left_layout.addWidget(form_group)

        button_grid = QGridLayout()
        self.all_button = QPushButton("다운로드 + 백테스트 실행")
        self.download_button = QPushButton("가격 다운로드만")
        self.run_button = QPushButton("CSV로 백테스트 실행")
        self.clear_button = QPushButton("로그 지우기")
        self.all_button.clicked.connect(lambda: self.start_job("all"))
        self.download_button.clicked.connect(lambda: self.start_job("download"))
        self.run_button.clicked.connect(lambda: self.start_job("run"))
        self.clear_button.clicked.connect(lambda: self.output.clear())
        button_grid.addWidget(self.all_button, 0, 0)
        button_grid.addWidget(self.download_button, 0, 1)
        button_grid.addWidget(self.run_button, 0, 2)
        button_grid.addWidget(self.clear_button, 0, 3)
        left_layout.addLayout(button_grid)

        self.chart = CloseChartWidget("평가금액 비교", "백테스트를 실행하면 전략/거치식 비교 그래프가 표시됩니다.", line_color="#2563eb")
        left_layout.addWidget(self.chart, 2)

        self.output = QTextEdit()
        self.output.setReadOnly(True)
        self.output.setStyleSheet("font-family: monospace; font-size: 13px;")
        self.output.setLineWrapMode(QTextEdit.LineWrapMode.NoWrap)
        self.output.setMinimumWidth(560)

        splitter.addWidget(left_column)
        splitter.addWidget(self.output)
        splitter.setStretchFactor(0, 1)
        splitter.setStretchFactor(1, 1)
        splitter.setSizes([760, 760])

        self.setCentralWidget(root)
        self.update_default_csv_path()

    def update_default_csv_path(self) -> None:
        self.csv_path.setText(str(default_csv_path(self.symbol.currentText())))

    def choose_csv(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "가격 CSV 선택", str(Path.cwd()), "CSV Files (*.csv);;All Files (*)")
        if path:
            self.csv_path.setText(path)

    def choose_json(self) -> None:
        path, _ = QFileDialog.getSaveFileName(self, "결과 JSON 저장", str(Path.cwd() / "BackTest" / "results" / "result.json"), "JSON Files (*.json);;All Files (*)")
        if path:
            self.json_path.setText(path)

    def build_job(self, mode: str) -> Job | None:
        try:
            principal = float(self.principal.text().strip())
            if principal <= 0:
                raise ValueError("원금은 0보다 커야 합니다.")

            csv_text = self.csv_path.text().strip()
            if not csv_text:
                raise ValueError("가격 CSV 경로가 필요합니다.")

            json_text = self.json_path.text().strip()
            return Job(
                mode=mode,
                symbol=self.symbol.currentText(),
                split_count=int(self.split_count.currentText()),
                principal=principal,
                start_date=self.start_date.text().strip(),
                end_date=self.end_date.text().strip(),
                compounding_type="simple" if self.simple.isChecked() else "compound",
                csv_path=Path(csv_text),
                json_path=Path(json_text) if json_text else None,
            )
        except Exception as error:
            QMessageBox.warning(self, "입력 확인", str(error))
            return None

    def set_buttons_enabled(self, enabled: bool) -> None:
        for button in [self.all_button, self.download_button, self.run_button, self.clear_button]:
            button.setEnabled(enabled)

    def start_job(self, mode: str) -> None:
        if self.thread is not None:
            QMessageBox.information(self, "실행 중", "이미 백테스트가 실행 중입니다.")
            return

        job = self.build_job(mode)
        if job is None:
            return

        self.output.append(f"\n>>> {mode} 시작: {job.symbol} {job.split_count}분할 {job.start_date}~{job.end_date}\n")
        self.set_buttons_enabled(False)

        self.thread = QThread()
        self.worker = BacktestWorker(job)
        self.worker.moveToThread(self.thread)
        self.thread.started.connect(self.worker.run)
        self.worker.finished.connect(self.handle_success)
        self.worker.failed.connect(self.handle_failure)
        self.worker.finished.connect(self.cleanup_thread)
        self.worker.failed.connect(self.cleanup_thread)
        self.thread.start()

    def handle_success(self, text: str, chart_payload: dict) -> None:
        self.output.append(text)
        series = chart_payload.get("series", []) if isinstance(chart_payload, dict) else []
        if series:
            self.chart.set_series(series)
        self.output.append(">>> 완료\n")

    def handle_failure(self, text: str) -> None:
        self.output.append(text)
        QMessageBox.critical(self, "실패", "작업 중 오류가 발생했습니다. 로그를 확인하세요.")

    def cleanup_thread(self) -> None:
        if self.thread:
            self.thread.quit()
            self.thread.wait()
        self.thread = None
        self.worker = None
        self.set_buttons_enabled(True)


def main() -> None:
    app = QApplication(sys.argv)
    window = BacktestWindow()
    window.show()
    sys.exit(app.exec())


if __name__ == "__main__":
    main()
