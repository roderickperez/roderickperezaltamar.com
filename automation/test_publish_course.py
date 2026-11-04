import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock
import json

spec = importlib.util.spec_from_file_location("publisher", Path(__file__).with_name("publish_course.py"))
publisher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(publisher)

class InventoryTests(unittest.TestCase):
    def test_instructor_files_are_excluded_and_student_files_included(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "generated").mkdir()
            (root / "index.html").write_text("html")
            (root / "generated" / "course.json").write_text("{}")
            (root / "generated" / "test_answer_key.md").write_text("private")
            (root / "generated" / "lesson.json").write_text("{}")
            self.assertEqual(set(publisher.build_inventory(root)),
                             {"index.html", "generated/course.json", "generated/lesson.json"})

    def test_manifest_is_published_only_after_all_objects(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "generated").mkdir()
            (root / "index.html").write_text("html")
            (root / "generated" / "course.json").write_text("{}")
            calls = []
            def request(method, path, **kwargs):
                calls.append((method, path, kwargs))
                if "grant_type=password" in path:
                    return b'{"access_token":"temporary"}'
                return b'{}'
            with mock.patch.object(publisher, "request", side_effect=request):
                publisher.publish("fault-segmentation", root, "publisher@example.com", "not-a-real-password")
            self.assertEqual(calls[-1][1], "/storage/v1/object/private-courses/fault-segmentation/current.json")
            manifest = json.loads(calls[-1][2]["data"])
            self.assertEqual(set(manifest["files"]), {"index.html", "generated/course.json"})
            self.assertTrue(all("/objects/" in call[1] for call in calls[1:-1]))

    def test_upload_failure_never_switches_manifest(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "generated").mkdir()
            (root / "index.html").write_text("html")
            (root / "generated" / "course.json").write_text("{}")
            calls = []
            def request(method, path, **kwargs):
                calls.append(path)
                if "grant_type=password" in path:
                    return b'{"access_token":"temporary"}'
                raise RuntimeError("test failure")
            with mock.patch.object(publisher, "request", side_effect=request):
                with self.assertRaises(RuntimeError):
                    publisher.publish("fault-segmentation", root, "publisher@example.com", "not-a-real-password")
            self.assertFalse(any(path.endswith("/current.json") for path in calls))

    def test_rejects_incomplete_build(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises(ValueError):
                publisher.build_inventory(Path(temp))

if __name__ == "__main__":
    unittest.main()
