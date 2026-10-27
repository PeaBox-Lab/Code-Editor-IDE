# PeaBox IDE v0.13 - Everyday Developer Workflow

## New in v0.13
- Test Explorer for Python `pytest` and Node package test scripts
- Discover, run one, or run all tests
- Test output and pass/fail status
- Project Tasks view backed by `.peabox/project.json`
- Built-in task editor using `Name = command` lines
- Runtime and editor Settings dialog
- Auto-save preference, theme and font size
- Portable Python and Git executable path settings
- Improved project test-provider detection
- Static `SMOKE_TEST.bat` for source validation

## End users
Use the packaged Windows ZIP and run `PeaBox IDE.exe`. The packaged release does not require Node.js, npm, or administrator rights.

## Source mode
Double-click `START_PEABOX_IDE.bat`. It uses portable Node from a local `node` folder or the previously supported helper path. Startup details are written to `peabox-startup.log`.

## Project tasks
Open **Tasks**, choose the gear button, and enter one task per line:

```text
Run app = python app.py
Tests = python -m pytest
Install = python -m pip install -r requirements.txt
```

Tasks are saved in `.peabox/project.json`. Only run commands from projects you trust.

## Testing
Python projects use `python -m pytest`; install pytest in the selected environment. Node projects use test-related scripts from `package.json`.
