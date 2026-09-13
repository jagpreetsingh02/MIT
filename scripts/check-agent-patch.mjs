import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const patch=process.argv[2];const text=readFileSync(patch,'utf8');
if(/(?:new file mode|old mode|new mode|deleted file mode) (?:120000|160000)/.test(text))throw new Error('Agent may not create symlinks or submodules.');
if(text.trim()){
  const lines=execFileSync('git',['apply','--numstat','-z',patch],{encoding:'utf8'}).split('\0').filter(Boolean);
  for(const line of lines){const path=line.split('\t').slice(2).join('\t');if(!/^(src\/web\/|src\/server\/graph\.ts$|tests\/|docs\/)/.test(path)||path.includes('..')||path.startsWith('docs/schemas/')||path==='docs/codex-config.toml'||path.endsWith('AGENTS.md'))throw new Error('Agent change outside permitted scope: '+path);}
}
