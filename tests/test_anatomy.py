"""python3 tests/test_anatomy.py — the hand-counting rules of the server's anatomy check (no model needed)."""
import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server'))
from anatomy import count_extra, _dedupe


class Hands(unittest.TestCase):
    def test_three_hands_on_one_person(self):
        # a real film frame: an old man with a hand at his chest and one at each side, a boy beside him
        persons = [[736, 712, 1281, 2466], [52, 559, 739, 2487]]
        hands = [[387, 1237, 632, 1380], [1101, 1655, 1234, 1794], [91, 1557, 228, 1718], [747, 1644, 843, 1765], [615, 1556, 725, 1707]]
        self.assertEqual(count_extra(persons, hands, persons, (1290, 2796)), 1)

    def test_two_people_four_hands_is_fine(self):
        persons = [[0, 0, 100, 300], [150, 0, 250, 300]]
        hands = [[10, 150, 30, 170], [70, 150, 90, 170], [160, 150, 180, 170], [220, 150, 240, 170]]
        self.assertEqual(count_extra(persons, hands, persons, (300, 320)), 0)

    def test_hand_at_the_edge_belongs_to_someone_out_of_frame(self):
        persons = [[20, 0, 300, 400]]
        hands = [[100, 200, 130, 230], [200, 200, 230, 230], [280, 300, 300, 340]]
        self.assertEqual(count_extra(persons, hands, persons, (300, 400)), 0)

    def test_more_faces_than_bodies_trusts_only_the_total(self):
        # a group on a sofa: one body found, three faces, someone's hand on the child's shoulder
        persons = [[100, 100, 200, 400]]
        hands = [[110, 150, 130, 170], [140, 300, 160, 320], [170, 300, 190, 320]]
        faces = [[120, 100, 160, 140], [220, 80, 260, 120], [300, 60, 340, 100]]
        self.assertEqual(count_extra(persons, hands, faces, (400, 420)), 0)

    def test_one_hand_found_twice_counts_once(self):
        hands = _dedupe([([100, 100, 140, 140], 0.6), ([110, 105, 150, 150], 0.4), ([300, 100, 340, 140], 0.5)], centres=True)
        self.assertEqual(len(hands), 2)


if __name__ == '__main__':
    unittest.main()
