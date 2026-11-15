from django.test import SimpleTestCase

from apps.lidar.sources.usgs import parse_year


class ParseYearTests(SimpleTestCase):
    def test_four_digit_year(self):
        self.assertEqual(parse_year("CA_LosAngeles_2016"), 2016)

    def test_last_year_wins_for_ranges(self):
        self.assertEqual(parse_year("TX_Central_2017_2018"), 2018)

    def test_las_delivery_year_is_ignored(self):
        self.assertEqual(parse_year("USGS_LPC_TX_Central_B1_2017_LAS_2019"), 2017)
        self.assertEqual(parse_year("USGS_LPC_IL_4County_Cook_2017_LAS_2019"), 2017)

    def test_work_unit_suffix(self):
        self.assertEqual(parse_year("NY_Hudson_1_D22"), 2022)
        self.assertEqual(parse_year("NY_SE4County_1_A22"), 2022)

    def test_no_year(self):
        self.assertIsNone(parse_year("NY_NewYorkCity"))
        self.assertIsNone(parse_year("IA_FullState"))

    def test_digits_that_are_not_years(self):
        self.assertEqual(parse_year("NY_FEMAR2_Central_2_2018"), 2018)
        self.assertIsNone(parse_year("AK_Area_12345"))
