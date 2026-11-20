# L3 subset: the scratch root's ownership record, sourced by setup.sh,
# teardown.sh and snapshot.sh. Defines functions only; runs nothing.
#
# setup.sh creates the scratch root itself (mkdir fails on any existing
# path) and writes <root>/.l3-owner before anything else:
#
#   foreman-l3-scratch 1
#   root <hex of the canonical root path>
#   id <device>:<inode of the root directory>
#   path <name>        one line per top-level path, appended before
#                      setup.sh creates it
#
# A record matches a directory only when the header, the path and the
# identity all agree and every name is one setup.sh creates. teardown.sh
# removes nothing unless the whole record matches.

l3_record_name=.l3-owner
l3_record_header="foreman-l3-scratch 1"
# Every top-level name setup.sh may create, besides the record itself.
l3_owned_names="home outside www out state remote.git owner claude-settings.json layout.env .l3-setup-done"

# The bytes of a path as lowercase hex, so a record line never holds a
# newline or a quote whatever the path contains.
l3_hex() {
  printf '%s' "$1" | od -An -v -tx1 | tr -d ' \n'
}

# The device and inode of a directory, as "device:inode".
l3_identity() {
  stat -f '%d:%i' "$1"
}

# Succeeds when a name is one setup.sh creates.
l3_is_owned_name() {
  case " $l3_owned_names " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

# Checks the record of the canonical root $1. On success sets
# l3_recorded_names to the recorded names, space-separated, in record
# order. On failure prints why to stderr and returns 1. Reads nothing
# outside $1.
l3_check_record() {
  l3_root=$1
  l3_record="$l3_root/$l3_record_name"
  l3_recorded_names=
  if [ -L "$l3_record" ] || [ ! -f "$l3_record" ]; then
    echo "no ownership record $l3_record_name in this directory" >&2
    return 1
  fi
  l3_line_number=0
  l3_expected_root="root $(l3_hex "$l3_root")"
  l3_expected_id="id $(l3_identity "$l3_root")" || return 1
  while IFS= read -r l3_line || [ -n "$l3_line" ]; do
    l3_line_number=$((l3_line_number + 1))
    case "$l3_line_number" in
      1) [ "$l3_line" = "$l3_record_header" ] || { echo "ownership record: wrong header" >&2; return 1; } ;;
      2) [ "$l3_line" = "$l3_expected_root" ] || { echo "ownership record: made for another root path" >&2; return 1; } ;;
      3) [ "$l3_line" = "$l3_expected_id" ] || { echo "ownership record: made for another directory" >&2; return 1; } ;;
      *)
        l3_name=${l3_line#path }
        if [ "$l3_name" = "$l3_line" ] || ! l3_is_owned_name "$l3_name"; then
          echo "ownership record: line $l3_line_number is not a path setup.sh creates" >&2
          return 1
        fi
        case " $l3_recorded_names " in
          *" $l3_name "*) echo "ownership record: $l3_name recorded twice" >&2; return 1 ;;
        esac
        l3_recorded_names="${l3_recorded_names:+$l3_recorded_names }$l3_name" ;;
    esac
  done < "$l3_record"
  if [ "$l3_line_number" -lt 3 ]; then
    echo "ownership record: truncated" >&2
    return 1
  fi
}

# Resolves an existing directory argument to its canonical path in
# l3_canonical, keeping every byte (a command substitution would drop
# trailing newlines). Returns 1 if it cannot enter the directory.
l3_canonicalize() {
  l3_canonical=$(cd -P -- "$1" && pwd -P && echo x) || return 1
  l3_canonical=${l3_canonical%?x}
}
