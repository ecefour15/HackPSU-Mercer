Run checks · PY
"""
run_checks.py: one command to run before every merge to main.
 
    python run_checks.py
 
Exit code 0 = all tests passed (safe to merge). Non-zero = do not merge.
Prints a short summary that is easy to screenshot for Devpost.
"""
 
import sys
import unittest
 
 
def main() -> int:
    suite = unittest.defaultTestLoader.discover(".", pattern="test_*.py")
    result = unittest.TextTestRunner(verbosity=1).run(suite)
 
    passed = result.testsRun - len(result.failures) - len(result.errors)
    print()
    print("=" * 52)
    print(f" Tests run: {result.testsRun}   Passed: {passed}")
    print(f" Failures: {len(result.failures)}   Errors: {len(result.errors)}")
    print(" RESULT:", "ALL GREEN - OK TO MERGE" if result.wasSuccessful() else "RED - DO NOT MERGE")
    print("=" * 52)
    return 0 if result.wasSuccessful() else 1
 
 
if __name__ == "__main__":
    sys.exit(main())