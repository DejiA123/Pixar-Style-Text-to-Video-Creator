"""python3 tests/test_anatomy.py — the hand- and arm-counting rules of the server's anatomy check (no model needed)."""
import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'server'))
from anatomy import count_extra, count_extra_arms, _dedupe

# a woman standing facing the camera in a 1000 x 1600 picture, arms at her sides
SIZE = (1000, 1600)
WOMAN = [300, 200, 700, 1500]
LEFT, RIGHT = [300, 450, 400, 900], [600, 450, 700, 900]


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


class Arms(unittest.TestCase):
    def test_two_arms_is_fine(self):
        self.assertEqual(count_extra_arms([WOMAN], [LEFT, RIGHT], [], SIZE), 0)

    def test_a_third_arm_from_the_chest(self):
        self.assertEqual(count_extra_arms([WOMAN], [LEFT, RIGHT, [420, 500, 520, 850]], [], SIZE), 1)

    def test_a_forearm_inside_its_arm_counts_once(self):
        forearm = [310, 680, 395, 900]
        self.assertEqual(count_extra_arms([WOMAN], [LEFT, RIGHT, forearm], [], SIZE), 0)
        self.assertEqual(count_extra_arms([WOMAN], [forearm, LEFT, RIGHT], [], SIZE), 0)  # whichever scored better

    def test_crossed_arms_are_no_glitch(self):
        self.assertEqual(count_extra_arms([WOMAN], [[380, 600, 620, 760], [390, 620, 610, 780], LEFT], [], SIZE), 0)

    def test_a_box_as_big_as_the_body_neither_counts_nor_hides_a_third_arm(self):
        body = [310, 400, 690, 1250]  # "an arm" around both arms and the body, scored best
        self.assertEqual(count_extra_arms([WOMAN], [body, LEFT, RIGHT], [], SIZE), 0)
        self.assertEqual(count_extra_arms([WOMAN], [body, LEFT, RIGHT, [420, 500, 520, 850]], [], SIZE), 1)

    def test_a_hug_is_four_arms_for_two_people(self):
        a, b = [200, 200, 560, 1500], [440, 220, 800, 1500]
        arms = [[230, 450, 330, 900], [470, 500, 560, 800], [450, 520, 540, 820], [700, 450, 790, 900]]
        self.assertEqual(count_extra_arms([a, b], arms, [], SIZE), 0)

    def test_a_mother_holding_her_baby(self):
        mother, baby = [250, 150, 750, 1500], [380, 600, 620, 900]
        arms = [[260, 400, 360, 950], [640, 400, 740, 950], [390, 700, 450, 790], [550, 700, 610, 790]]
        self.assertEqual(count_extra_arms([mother, baby], arms, [], SIZE), 0)

    def test_an_arm_at_the_edge_belongs_to_someone_out_of_frame(self):
        self.assertEqual(count_extra_arms([WOMAN], [LEFT, RIGHT, [640, 300, 1000, 420]], [], SIZE), 0)

    def test_more_faces_than_bodies_trusts_only_the_total(self):
        faces = [[420, 220, 580, 400], [100, 250, 220, 400]]  # someone beside her whose body wasn't found
        self.assertEqual(count_extra_arms([WOMAN], [LEFT, RIGHT, [420, 500, 520, 850]], faces, SIZE), 0)
        self.assertEqual(count_extra_arms([WOMAN], [LEFT, RIGHT, [420, 500, 520, 850], [520, 950, 600, 1250], [310, 950, 400, 1250]], faces, SIZE), 1)


if __name__ == '__main__':
    unittest.main()
