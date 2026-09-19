#!/bin/zsh
# Captures one `fm` run into a fixture directory.
# usage: OUT=<fixture dir> probe.sh <name> <null|pipe|tty> -- <fm args...>
#   null: stdin is /dev/null   pipe: stdin is `echo no`   tty: stdin is a pty via script(1)
# Writes cmd.txt, stdin_mode.txt, stdout.txt, stderr.txt, exit.txt, seconds.txt (and tty.txt for tty).
OUT=${OUT:?set OUT to the fixture directory}
TO=${0:A:h}/to  # perl alarm wrapper; macOS has no timeout(1)
name=$1; mode=$2; shift 3
d=$OUT/$name; mkdir -p $d
print -r -- "fm ${(q)@}" > $d/cmd.txt; echo $mode > $d/stdin_mode.txt
t0=$(perl -MTime::HiRes=time -e 'printf "%.3f", time')
case $mode in
  null) $TO 10 fm "$@" </dev/null >$d/stdout.txt 2>$d/stderr.txt; rc=$? ;;
  pipe) echo "no" | $TO 10 fm "$@" >$d/stdout.txt 2>$d/stderr.txt; rc=$? ;;
  tty)  echo "no" | $TO 10 script -q $d/tty.txt fm "$@" >$d/stdout.txt 2>$d/stderr.txt; rc=$? ;;
esac
t1=$(perl -MTime::HiRes=time -e 'printf "%.3f", time')
echo $rc > $d/exit.txt; echo "$t1 - $t0" | bc > $d/seconds.txt
# For an unlicensed capture, set EXPECT_UNLICENSED=1. Agreeing to the license applies to the
# whole machine, so a probe must never cause it.
[[ -n $EXPECT_UNLICENSED && -e /Library/Preferences/com.apple.fm.plist ]] && echo "!!! PLIST APPEARED after $name"
printf "%-32s %-5s exit=%-4s %5ss out=%-5s err=%s\n" $name $mode $rc $(cat $d/seconds.txt) $(wc -c <$d/stdout.txt) $(wc -c <$d/stderr.txt)
