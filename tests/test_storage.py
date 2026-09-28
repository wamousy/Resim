import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src'))
from resim_policy_storage import commit_inputs, recover, store_lock, JOURNAL, ALLOWED
from resim_policy_portable import pack_project, unpack_project


class StorageTests(unittest.TestCase):
    def test_real_process_exit_at_each_commit_boundary_recovers_complete_generation(self):
        for step in ['journal', *ALLOWED]:
            with self.subTest(step=step), tempfile.TemporaryDirectory() as tmp:
                folder = Path(tmp)
                commit_inputs(folder, {name: 'old' for name in ALLOWED})
                script = "import sys,os;sys.path.insert(0,sys.argv[1]);from resim_policy_storage import *;commit_inputs(Path(sys.argv[2]),{n:'new' for n in ALLOWED},lambda step:os._exit(17) if step==sys.argv[3] else None)"
                run = subprocess.run([sys.executable, '-c', script, str(Path(__file__).resolve().parents[1] / 'src'), tmp, step])
                self.assertEqual(run.returncode, 17)
                with store_lock(folder): self.assertTrue(recover(folder))
                self.assertFalse((folder / JOURNAL).exists())
                self.assertTrue(all((folder / name).read_text() == 'new' for name in ALLOWED))
                self.assertFalse(recover(folder))

    def test_concurrent_processes_never_read_mixed_input_generations(self):
        with tempfile.TemporaryDirectory() as tmp:
            script = """import sys,time
sys.path.insert(0,sys.argv[1])
from resim_policy_storage import *
root=Path(sys.argv[2])
for i in range(12):
    with store_lock(root):
        value=sys.argv[3]+':'+str(i)
        commit_inputs(root,{n:value for n in ALLOWED})
        time.sleep(.001)
        assert { (root/n).read_text() for n in ALLOWED }=={value}
"""
            children = [subprocess.Popen([sys.executable, '-c', script, str(Path(__file__).resolve().parents[1] / 'src'), tmp, str(i)]) for i in range(3)]
            for child in children: self.assertEqual(child.wait(timeout=30), 0)

    def test_invalid_journal_never_writes_input(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / JOURNAL).write_text(json.dumps({'version':1,'files':{'../outside':{'text':'bad','sha256':'x'}}}))
            with self.assertRaises(ValueError): recover(root)
            self.assertFalse((root.parent / 'outside').exists())


class PortableTests(unittest.TestCase):
    def example(self, root):
        folder=root/'source'/'demo'; (folder/'inputs').mkdir(parents=True)
        (folder/'project.json').write_text(json.dumps({'id':'demo','name':'demo'}))
        for name in ('chip-architecture.yml','technology.yml'): (folder/'inputs'/name).write_text('schema_version: test\n')
        run=root/'external'/'run1';run.mkdir(parents=True)
        meta={'project_id':'demo','run_id':'run1','status':'completed','mode':'evaluate','run_dir':str(run),'output_run_dir':str(run)}
        (run/'run.json').write_text(json.dumps(meta))
        (run/'results').mkdir()
        (run/'results'/'resource-report.json').write_text(json.dumps({'summary':{'power_W':None},'storage':meta,'provenance':{'engine_sha256':'known'}}))
        (folder/'runs'/'run1').mkdir(parents=True)
        (folder/'runs'/'run1'/'run.json').write_text(json.dumps(meta))
        return folder

    def test_external_results_are_collected_and_relocated_without_changing_metrics(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);folder=self.example(root);bundle=root/'bundle.zip'
            self.assertEqual(pack_project(folder,bundle)['runs'],1)
            imported=unpack_project(bundle,root/'destination');target=Path(imported['project_dir'])
            record=json.loads((target/'runs/run1/run.json').read_text())
            self.assertNotIn('output_run_dir',record)
            self.assertEqual(record['run_dir'],str(target/'runs/run1'))
            result=json.loads((target/'runs/run1/results/resource-report.json').read_text())
            self.assertIsNone(result['summary']['power_W']);self.assertEqual(result['provenance']['engine_sha256'],'known')
            self.assertTrue((target/'import-receipt.json').exists())
            with self.assertRaises(FileExistsError): unpack_project(bundle,root/'destination')
            with self.assertRaises(FileExistsError): pack_project(folder,bundle)

    def test_corruption_and_traversal_fail_before_publishing_project(self):
        import zipfile
        for mode in ('hash','path'):
            with self.subTest(mode=mode),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);source=root/'good.zip';pack_project(self.example(root),source)
                with zipfile.ZipFile(source) as z: entries={n:z.read(n) for n in z.namelist()}
                manifest=json.loads(entries['bundle.json'])
                if mode=='hash': entries['project/project.json']=b'corrupted'
                else:
                    manifest['files']['project/../../outside']=manifest['files'].pop('project/project.json')
                    entries['project/../../outside']=entries.pop('project/project.json')
                entries['bundle.json']=json.dumps(manifest).encode()
                bad=root/'bad.zip'
                with zipfile.ZipFile(bad,'w') as z:
                    for name,data in entries.items(): z.writestr(name,data)
                with self.assertRaises(ValueError): unpack_project(bad,root/'new')
                self.assertFalse((root/'new'/'demo').exists())
                self.assertFalse(list((root/'new').glob('.resim-import-*')))


if __name__=='__main__': unittest.main()
