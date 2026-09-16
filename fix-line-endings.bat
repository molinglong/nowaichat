@echo off
chcp 65001 >nul
REM Convert start-desktop.* from LF to CRLF (Windows CMD needs CRLF!)
python -c "import os;base=r'D:\xiaz\项目表\chatchat\aichatt\aichatt\aichatt\aichatt';[open(os.path.join(base,n),'wb').write(open(os.path.join(base,n),'rb').read().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n')) for n in ['start-desktop.bat','start-desktop.ps1']];print('CRLF fixed')"