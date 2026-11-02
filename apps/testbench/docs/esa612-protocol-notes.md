# ESA612 and ProSim 8 remote protocol notes

These notes come from the claude.ai project "Ansur To PDF". They record what the real units accept and refuse. Read them before changing the serial driver or adding commands.

## Windows setup (both devices)
- Both use an FTDI FT232R USB chip (VID 0403 / PID 6001). Ansur can talk to them without a COM port, and the COM port may be switched off.
- For the browser, each device must appear in Device Manager under **Ports (COM & LPT)** as "USB Serial Port (COMx)".
  - If one only shows as "USB Serial Converter" under *Universal Serial Bus controllers*: Properties → Advanced → tick **Load VCP**, then unplug and replug.
- Only one program can hold a port at a time, so close Ansur first.
- Web Serial works from a `file://` page in Chrome/Edge (secure context = true), and on https.
- **Web Serial does not work in embedded preview panes or frames whose permissions policy switches serial off.** The error is "Access to the feature 'serial' is disallowed by permissions policy". The Test Bench detects this and shows a banner.
  - When embedding the bench in the hub, the iframe needs `allow="serial"`.

## Connection reliability (driver rewritten 23/10/2026)

**The problem seen:** "Unrecognised device: *".
- The ESA612 sent a stale `*` just as the page asked for IDENT, and the old driver took the next line as the answer. The stale `*` was, for example, the reply to stopping a reading stream left running from an earlier session.
- The intermittent first-command `!` is the same effect: the reply to an empty or half-received command.

**How the driver connects and talks now:**
1. Open at 115200 8N1 with a 4 KB buffer, and assert DTR (and RTS when flow control is off).
2. Clear the line:
   - send ESC (stops any MREAD stream) and wait until quiet
   - send CR LF (ends any half-received command) and wait until quiet
   - discard everything received meanwhile, logged as "Ignored stale reply"
3. Send IDENT up to 4 times, accepting only a reply that looks like an ident (`ESA6xx` or `PROSIM`). The line is cleared between attempts.
4. If nothing identifies with hardware flow control, close, reopen with flow control off, and repeat. The setting that worked is remembered (localStorage `chsBench.flow`) and tried first next time.
5. Every command waits for the reply it should get:
   - `*` for settings and actions on the ESA612
   - a number for `READ`
   - `RMAIN`/`LOCAL` for ProSim mode changes
   - Errors (`!…`) are accepted as the reply, **except `!21` while waiting for a `*`** (see 02/11/2026 below). Anything else is ignored as stale.
6. Timeouts are retried once after clearing the line (REMOTE up to 3 times). All commands the Test Bench sends are safe to repeat.
7. **Leave at least 150 ms between a reply and the next command on the ESA612** (30 ms on the ProSim).
   - On 23/10 the ESA612 ignored REMOTE sent 1 ms after the IDENT reply, and IDLE sent 0 ms after the SN reply. Both worked on retry.
8. Writes time out after 3 s instead of hanging if the device holds CTS low.
9. After stopping a reading stream, readings already in flight are drained before the next command.
10. If the device still doesn't identify, a dialog offers Try again plus the usual checks (home screen, Ansur closed, replug USB).

**Confirmed on the real analyser, 23/10/2026:** connects reliably with flow control on; stale `*` and `!` were seen and ignored as designed.

### Trailing `!21` after an over-range stream (02/11/2026)
- **What happened:** testing a Class I power supply with an isolated output (insulation over range), the next commands failed with "IDLE: error 21", "ENCL: error 21" and "EARTHL: error 21".
- **Why:** when a reading stream is over range, the ESA612 sends `!21 ADC out of range` instead of a value, and some of these arrive after the stream is stopped. The driver took a late `!21` as the answer to the next command.
- **Fix:** `!21` is a reading error and can't be the answer to a setting or test-selection command, so the driver now skips `!21` while waiting for a `*` (logged as "Ignored stale reply: !21").
- `!21` is still accepted as a `READ` reply, and still means over range during a measurement.
- Reproduced and fixed in the simulator (`ins21` option). **To be confirmed on the real unit.**

## Measuring

**Timing and readings**
- After each setup, wait 0.6 s. Wait 2 s when the outlet is newly powered (like Ansur's "Delay On 2 s").
- Readings are taken with MREAD and shown live.
  - If the stream reports an error or goes quiet for 2.5 s, it is restarted (up to 2 times), then the page switches to single `READ`s.
  - After the settle time it keeps trying for up to 8 s more before giving up.
- **`!21 ADC out of range` is treated as an over-range reading, not a failure to communicate.**
  - It's recorded at the top of the meter's range (Ω 2, MΩ 100, µA 10000, V 300, from Fluke's status-word ranges) and judged as over range.
  - Earth resistance ">2 Ω (open circuit)" fails; insulation over range passes a minimum limit; leakage over range fails a maximum.
- A failed measurement names the ESA612's last reply.
- Lead zeroing for PE resistance can be skipped. The result is labelled "(lead not zeroed)" (the report leaves that note off) and the skip is logged.
- After a test fails in an auto sequence, the run offers **Measure again** or **Continue from next test**.

**Command order:** select the test first (`MAINS=`, `ERES`, `MINS`/`APINS`, `EARTHL`, `ENCL`, `PAT`), then send its settings (`INS=`, `AP=`, `POL=`, `NEUT=`, `EARTH=`).
- A refused `INS=HIGH` is carried on from (500 V is the default).
- **Mains on applied parts:**
  - Fluke's interface manual says bare `MAP` (or `MAP=` with no value) selects the test, and `MAP=NORM`/`MAP=REV` only set the MAP voltage polarity.
  - Our unit refused `AP=` sent after `MAP=NORM` (23/10). The 23/10 attempt `PAT`, `AP=`, `MAP=NORM` also failed.
  - The Test Bench sends `IDLE`, `MAP`, `AP=…//OPEN`, `MAP=NORM`, `POL=N`. It sends no `NEUT=`/`EARTH=`, because the user manual lists only normal and reversed polarity for MAP.
  - Fallbacks, in order: polarity before posts; `AP=` without `//OPEN`; `MAP=` with no value; posts under `PAT` then `MAP`.
  - The order that works is remembered. If all are refused, every attempt is written to the Log.
  - **Confirmed working on our ESA612, 23/10/2026.**
- **Earth leakage sends no `EARTH=` command.** The analyser refuses it, because earth leakage is measured in the earth conductor.
- A refused `NEUT=C` or `EARTH=C` (closing a switch the test doesn't have; closed is the default) is carried on from. A refused `NEUT=O`/`EARTH=O` still stops the test, since the fault condition wouldn't be applied.
- The outlet is switched off with `IDLE`, never a bare `POL=OFF`.

**Insulation B, D and E** (mains–applied parts, mains–non-earthed accessible part, applied parts–non-earthed accessible part):
- Fluke only names them as commands, `INSB`/`INSD`/`INSE`.
- The bench selects each and asks `FN`. Expected: 23 = mains–applied parts, 21 = mains–non-earth part, 22 = applied parts–non-earth part. If `FN` doesn't answer, it asks the operator what the screen shows.
- The mapping is remembered in prefs (`insMap`) and cleared by Run diagnostics.
- **Not yet verified on the real ESA612.**

**Powering the device under test:** "Power the device" switches on the ESA612 outlet with the equipment-current test (`IDLE`, `EQCURR`, `POL=N`) and shows the current drawn. Any ESA612 measurement switches it off first. **`EQCURR` not yet verified on the real unit.**

## Applied-part groups
- A template holds a list of applied-part groups. Each has:
  - a name (e.g. ECG, SpO2)
  - a type: **B** body, **BF** body floating, **CF** cardiac floating
  - the ESA612 posts it is connected to (RA, LA, LL, RL, V1)
- Patient leakage and mains on applied parts measure each group on its own: `AP=<that group's posts>//OPEN`, with the other posts left open.
- Limits come from each group's type:
  - patient leakage: B/BF 100/500 µA, CF 10/50 µA
  - MAP: BF 5000 µA, CF 50 µA; not measured for type B
- Changing groups mid-test clears the patient leakage and MAP results already measured (after a confirmation).
- Each post should be in only one group.

## ESA612: verified on our analyser

Analyser: **ESA612B, firmware v3.01** (CMCHS). Verified 15/10/2026 and 23/10/2026.
Reference: Fluke Biomedical *ESA612/615 Communications Interface* rev 1.2 (03/12/2018).

**Link:** 115200 baud, 8N1, hardware flow control (per Fluke). Commands end with `\r\n`; replies end with CR LF.

| Command | Reply | Notes |
|---|---|---|
| `REMOTE` | `*` (about 390 ms) | Ignored once when sent 1 ms after the IDENT reply. The 150 ms gap prevents that. |
| `IDENT` | `ESA612B, v3.01` | Format differs from the manual's example. |
| `SN` | (the analyser's serial number) | Answered on 23/10. No reply on 15/10, probably the same timing issue. |
| `STD=ASNZ` | `*` | |
| `MODE=AC` | `!02` (illegal command) | Rejected straight after REMOTE/IDENT. Not needed for mains (readings are already AC). |
| `MAINS=L1-L2` / `L1-GND` / `L2-GND` | `*` | |
| `MREAD` | `*`, then a reading every ~175–190 ms (mains) or ~400 ms (errors during ERES) | The manual says ~400 ms. |
| `<ESC>` (during MREAD) | `*` | Stops the stream. After an over-range stream, late `!21` lines can still follow. |
| `IDLE`, `LOCAL` | `*` | |
| `POL=OFF` | `!02` | Seen with no leakage test selected. `POL=`, `MODE=` and `INS=` appear legal only while a test that uses them is selected. |
| `INS=HIGH` | `!02` | Seen when sent before `MINS`. |
| `IDLE`, `ERES` + reading | PE passed on 23/10 with the lead connected | With the lead not connected, MREAD/READ gave `!21` repeatedly (open circuit). |
| `MINS`, `APINS` (then `INS=HIGH`) | passed / recorded on 23/10 | |
| `ENCL`, `POL=N`, `NEUT=C/O`, `EARTH=C/O` | Enclosure leakage passed on 23/10 | `POL=`, `NEUT=` and `EARTH=` are all legal once `ENCL` is selected. |
| `EARTHL` then `EARTH=C` | `!02` | 23/10. The bench no longer sends `EARTH=` for earth leakage. |
| `EARTHL`, `POL=N`, `NEUT=C/O` | Earth leakage passed on 23/10 after the fix | |
| `PAT`, `AP=ALL//OPEN`, `POL=N`, … | Patient leakage passed on 23/10 | `AP=` is legal under `PAT`. |
| `MAP=NORM` then `AP=ALL//OPEN` | `!02` | 23/10. See the MAP order above. |
| `IDLE`, `ENCL`, `EARTHL` after an over-range insulation reading | `!21` arrived first | 02/11/2026: late `!21` from the stopped stream. Now skipped while waiting for `*`. |

**Reading format:** `230.9 VAC` = number, space, unit with the mode appended (`V` + `AC`). Leading-dot numbers were seen in Ansur records (e.g. `.142`), so parse both forms.

**Errors:**
- `!NN` = error code NN: `02` illegal command, `21` ADC out of range, `37` reading not available.
- `!` alone = rejected without a code (seen as the reply to an empty line).

**Mains readings seen:**
- 15/10: L–N 229.4–231.6 V, L–E 230.6–230.9 V, N–E 0.1 V
- 23/10: L–N 233.5 V, L–E 233.7 V, N–E 0.1 V

**Still to verify:**
- Patient leakage with a subset of posts (e.g. `AP=RA,LA,LL//OPEN`).
- Reversed polarity (`POL=R`); not used by the current templates.
- Exact reading formats for resistance, insulation and leakage. The Run diagnostics report answers these in one go.
- Whether over-range insulation comes back as `!21` or as a `>` reading (the 02/11 errors suggest `!21`).
- INSB/INSD/INSE FN mapping, and `EQCURR`.

## ProSim 8

Reference: Fluke Biomedical *ProSim 8 Communications Interface* v3.17.
Simulator: **ProSim 8, firmware 2.08.03**. Verified 15/10/2026:

| Command | Reply | Notes |
|---|---|---|
| `IDENT` | `PROSIM8,2.08.03` | Answered first time. |
| `QMODE` | `LOCAL` | |
| `REMOTE` | `RMAIN` | Only legal from LOCAL mode. |
| `SN` | (the simulator's serial number) | |
| `QBAT` | `100` | Battery %, 3 digits. |

Replies come back in about 15 ms (REMOTE ~200 ms).

**From the manual, not yet verified:**
- `LOCAL` replies `LOCAL`.
- Errors: `!` empty command, `!01` unknown, `!02` illegal in current mode, `!03` illegal parameter, `!22` can't zero pressure, `!27` SpO2 module comms error.
- Commands prefixed with `@` pass through to the SpO2 module. It's unclear whether `SAT`/`SPO2TYPE` need it; the bench retries with `@` if the plain command returns `!01`.
- Signed parameters need `+`/`-` (e.g. `IBPS=1,+200`).

**Typical settings the templates send:** `NSRA=060`, `ECGAMPL=1.00`, `ECGRUN=TRUE`, `RESPRATE=020`, `RESPRUN=TRUE`, `SPO2TYPE=MINDR`, `SAT=097`, `NIBPP=120,080`, `NIBPRUN=TRUE`, `TEMP=37.0`, `IBPS=1,+200`. Finishing a run sends `ECGRUN=FALSE`, `RESPRUN=FALSE`, `NIBPRUN=FALSE`.

**Deliberately blocked:** `RESET`, `PAIR`/`UNPAIR`, pressure source (`PS`, `PST`), `NIBPLEAK`, `NIBPPOP`, `ZPRESS`, `CZPRESS`.
