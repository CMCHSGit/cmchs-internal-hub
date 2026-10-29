"""Tests for hub_firestore.py, with a fake session (no network):
    cd backend/tile-sync && python -m unittest test_hub_firestore
(needs google-auth only for access_token(), which isn't called here)."""
import asyncio
import unittest

import hub_firestore as hf


class Resp:
    def __init__(self, status=200, data=None):
        self.status, self._data = status, data or {}

    async def json(self):
        return self._data

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


class FakeSession:
    def __init__(self, get=None, post=None):
        self.gets, self.posts, self._get, self._post = [], [], list(get or []), list(post or [])

    def get(self, url, **kw):
        self.gets.append((url, kw))
        return self._get.pop(0)

    def post(self, url, **kw):
        self.posts.append((url, kw))
        return self._post.pop(0) if self._post else Resp()


run = asyncio.run
names = lambda ids: [{"name": f"projects/p/databases/(default)/documents/tileLocations/{i}"} for i in ids]


class Tests(unittest.TestCase):
    def test_choose_target(self):
        self.assertEqual(hf.choose_target("auto", "firestore"), "firestore")
        self.assertEqual(hf.choose_target(None, "rtdb"), "rtdb")
        self.assertEqual(hf.choose_target("auto", None), "rtdb")  # unreadable switch: stay on the old database
        self.assertEqual(hf.choose_target("both", "rtdb"), "both")
        self.assertEqual(hf.choose_target(" Firestore ", "rtdb"), "firestore")
        with self.assertRaises(ValueError):
            hf.choose_target("everything", "rtdb")

    def test_credentials_info(self):
        self.assertIsNone(hf.credentials_info({"FIREBASE_PROJECT_ID": "p"}))
        info = hf.credentials_info({"FIREBASE_PROJECT_ID": "p", "FIREBASE_CLIENT_EMAIL": "e@p.iam", "FIREBASE_PRIVATE_KEY": "a\\nb"})
        self.assertEqual((info["project_id"], info["private_key"]), ("p", "a\nb"))

    def test_values(self):
        f = hf.to_fields({"s": "x", "n": None, "i": 3, "d": 1.5, "b": True})
        self.assertEqual(f["s"], {"stringValue": "x"})
        self.assertEqual(f["n"], {"nullValue": None})
        self.assertEqual(f["i"], {"integerValue": "3"})
        self.assertEqual(f["d"], {"doubleValue": 1.5})
        self.assertEqual(f["b"], {"booleanValue": True})  # a bool is not an integer

    def test_plan_sets_each_and_removes_the_gone(self):
        w = hf.plan_writes("p", {"1": {"tileNo": "1"}, "2": {"tileNo": "2"}}, ["2", "9"])
        self.assertEqual([x["delete"] for x in w if "delete" in x], ["projects/p/databases/(default)/documents/tileLocations/9"])
        self.assertEqual([x["update"]["name"].rsplit("/", 1)[1] for x in w if "update" in x], ["1", "2"])

    def test_no_records_deletes_nothing(self):
        self.assertEqual(hf.plan_writes("p", {}, ["1", "2"]), [])

    def test_batches(self):
        self.assertEqual([len(b) for b in hf.batches(list(range(900)))], [400, 400, 100])
        self.assertEqual(list(hf.batches([])), [])

    def test_read_source(self):
        ok = lambda s: Resp(200, {"fields": {"source": {"stringValue": s}}})
        self.assertEqual(run(hf.read_source(FakeSession([ok("firestore")]), "p", "t")), "firestore")
        self.assertEqual(run(hf.read_source(FakeSession([Resp(404)]), "p", "t")), "rtdb")
        self.assertIsNone(run(hf.read_source(FakeSession([Resp(403)]), "p", "t")))
        self.assertEqual(run(hf.read_source(FakeSession([Resp(200, {"fields": {}})]), "p", "t")), "rtdb")

    def test_write_records_pages_and_commits(self):
        s = FakeSession(get=[Resp(200, {"documents": names(["1", "9"]), "nextPageToken": "n"}), Resp(200, {"documents": names(["2"])})])
        out = run(hf.write_records(s, "p", "t", {"1": {"tileNo": "1"}, "2": {"tileNo": "2"}}))
        self.assertEqual(out, (2, 1, 0))
        self.assertEqual(len(s.posts), 1)
        self.assertEqual(s.gets[1][1]["params"]["pageToken"], "n")

    def test_failed_commit_is_counted_not_raised(self):
        s = FakeSession(get=[Resp(200, {})], post=[Resp(500)])
        self.assertEqual(run(hf.write_records(s, "p", "t", {"1": {"tileNo": "1"}})), (0, 0, 1))

    def test_list_failure_raises_so_nothing_is_half_done(self):
        with self.assertRaises(RuntimeError):
            run(hf.write_records(FakeSession(get=[Resp(403)]), "p", "t", {"1": {}}))


if __name__ == "__main__":
    unittest.main()
