# L3 subset: the listener's port, sourced by run-case.sh and
# test-scripts.sh. Defines a function only; runs nothing.
#
# The live run uses 47613, the port the prompts name (prompts/c4-sandbox.txt
# and prompts/c5-direct.txt) and score.py's LISTENER_URL holds; plan.md's
# listener() binds it. The offline tests may take another port from
# L3_PORT, so that a run of them does not need 47613 free and two runs on
# distinct ports do not meet. A stray L3_PORT in the live run fails
# closed: run-case.sh's live requests then go to a port where the
# operator's listener is not, so no client starts.

l3_default_port=47613

# l3_listener_port: prints L3_PORT when it is set, or the default when it
# is not. Fails with a message when L3_PORT is set but is not a decimal
# number from 1024 to 65535 without a leading zero (an empty value too).
l3_listener_port() {
  if [ -z "${L3_PORT+set}" ]; then
    printf '%s\n' "$l3_default_port"
    return 0
  fi
  case "$L3_PORT" in
    [1-9][0-9][0-9][0-9]|[1-9][0-9][0-9][0-9][0-9]) ;;
    *) echo "L3_PORT is not a port number from 1024 to 65535: '$L3_PORT'" >&2; return 1 ;;
  esac
  if [ "$L3_PORT" -lt 1024 ] || [ "$L3_PORT" -gt 65535 ]; then
    echo "L3_PORT is not a port number from 1024 to 65535: '$L3_PORT'" >&2
    return 1
  fi
  printf '%s\n' "$L3_PORT"
}
