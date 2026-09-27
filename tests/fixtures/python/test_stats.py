import unittest
from stats import sum_values

class StatisticsTests(unittest.TestCase):
    def test_empty(self): self.assertEqual(sum_values([]), 0)
    def test_normal(self): self.assertEqual(sum_values([1, 2, 3]), 6)
    def test_negative(self): self.assertEqual(sum_values([-1, 0, 1]), 0)

if __name__ == '__main__':
    unittest.main()
