# PeaBox IDE v0.9 — Developer Workflow

## New in v0.9
- Visual side-by-side Git diff using Monaco Diff Editor
- Richer Source Control changes list with file status, stage and diff actions
- Recent commit history in Source Control
- Split editor with a second Monaco editor pane
- Project Dashboard showing detected project type, file count, Git branch and change count
- Run profiles from `.peabox/project.json`
- Automatic starter run-profile generation for Python and Node projects
- Markdown preview powered by `marked`
- Enhanced Explorer presentation with clearer file/folder glyphs

## Run profiles
Example `.peabox/project.json`:
```json
{
  "name": "My App",
  "commands": {
    "run": "python app.py",
    "test": "pytest",
    "install": "pip install -r requirements.txt"
  }
}
```
Commands execute locally in the opened project directory. Review project profiles before running commands from projects you do not trust.

## Installation
Extract into a fresh folder and run `setup-peabox-ide.bat`. Later launches use `run-peabox-ide.bat`.

## Portable build
Run `build-portable-exe.bat`; output goes to `dist`.
