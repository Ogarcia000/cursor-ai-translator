import sys

import argostranslate.package


def main() -> None:
    from_code = sys.argv[1] if len(sys.argv) > 1 else "en"
    to_code = sys.argv[2] if len(sys.argv) > 2 else "es"

    argostranslate.package.update_package_index()
    available_packages = argostranslate.package.get_available_packages()
    package_to_install = next(
        package
        for package in available_packages
        if package.from_code == from_code and package.to_code == to_code
    )
    argostranslate.package.install_from_path(package_to_install.download())
    print(f"Installed Argos model: {from_code} -> {to_code}")


if __name__ == "__main__":
    main()
