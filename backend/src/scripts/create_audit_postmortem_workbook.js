import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const outDir = 'C:/Users/waizt/.gemini/antigravity/brain/9240cc1b-f576-4996-a196-552f1f9e4603';

// Read both workbooks to combine into an absolute transparent audit
const exact7 = XLSX.readFile(path.join(outDir, 'nexus_quant_strategy_7_trend_filter_two_stage_EXACT.xlsx'));
const exact8 = XLSX.readFile(path.join(outDir, 'nexus_quant_strategy_8_btc_safe_trend_two_stage_EXACT.xlsx'));
const clean7 = XLSX.readFile(path.join(outDir, 'nexus_quant_strategy_7_trend_filter_two_stage.xlsx'));
const clean8 = XLSX.readFile(path.join(outDir, 'nexus_quant_strategy_8_btc_safe_trend_two_stage.xlsx'));

const auditWB = XLSX.utils.book_new();

const explanation = [
  { 'TRANSPARENT POST-MORTEM': 'Why Did the Table Show 69.2% / 100% While The Clean Excel Showed Losses?' },
  {},
  { 'TRANSPARENT POST-MORTEM': '1. THE INITIALIZATION BUG IN THE PREVIOUS SCRIPT', 'DETAILS': 'In test_everything_master_quant.js, calculateRSI14 initialized bars 0 to 13 with 0.' },
  { 'TRANSPARENT POST-MORTEM': '2. THE FAKE SIGNAL TRIGGER', 'DETAILS': 'At bar 0-13, RSI was 0 (< 30). At bar 14 (14:00 UTC on Jan 1, 2026), RSI calculated its first real value (63 - 92). The code treated jumping from 0 to 63 as a cross from oversold (<30) to purple area (>=30).' },
  { 'TRANSPARENT POST-MORTEM': '3. WHY IT SHOWED HUGE PROFIT', 'DETAILS': 'Jan 1st, 2026 was a massive market-wide pump day. Entering every coin at 14:00 UTC on Jan 1st produced 9 wins and 0 losses on BTC Safe, artificially inflating the win rate to 69.2% and 100%!' },
  { 'TRANSPARENT POST-MORTEM': '4. WHAT HAPPENED WHEN CLEANED', 'DETAILS': 'When a 120-bar warmup was added in the next script, those fake Jan 1st entries were removed. Without those fake pump trades, real RSI < 30 drops in 1H downtrends hit stop losses, exposing that the strategy actually loses money without additional structure.' }
];

XLSX.utils.book_append_sheet(auditWB, XLSX.utils.json_to_sheet(explanation), 'Bug Post-Mortem & Truth');
XLSX.utils.book_append_sheet(auditWB, exact7.Sheets['Every Single Completed Trade'], 'Table Trades (With Jan 1 Bug)');
XLSX.utils.book_append_sheet(auditWB, clean7.Sheets['1H Trade Log (All Trades)'], 'Clean Trades (120-Bar Warmup)');

XLSX.writeFile(auditWB, path.join(outDir, 'nexus_quant_strategy_7_and_8_INITIALIZATION_BUG_AUDIT.xlsx'));
console.log('Saved audit workbook successfully.');
