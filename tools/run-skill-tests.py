#!/usr/bin/env python3
"""The repository gate for real verification/intake helper behavior."""

from pathlib import Path
import sys
import unittest


if __name__ == '__main__':
    if sys.version_info < (3, 11):
        sys.exit('Skill helpers require Python 3.11+; install it before running validate.')
    root = Path(__file__).resolve().parent.parent
    suite = unittest.TestSuite()
    for directory in ['tools/verification', '.agents/skills/deliver-linear/scripts']:
        suite.addTests(unittest.TestLoader().discover(str(root / directory), pattern='test_*.py'))
    print(f'Skill helper tests: Python {sys.version.split()[0]}, {suite.countTestCases()} cases', flush=True)
    if not suite.countTestCases():
        sys.exit('No skill-helper tests were selected.')
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
