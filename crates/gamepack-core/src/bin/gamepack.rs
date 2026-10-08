use std::io::{self, BufRead};

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(root) = args.next() else {
        eprintln!("Usage: gamepack DATA_DIRECTORY [JSON_REQUEST]\nWithout JSON_REQUEST, reads one JSON request per stdin line.");
        std::process::exit(2);
    };
    if let Some(request) = args.next() {
        println!("{}", gamepack_core::dispatch(&root, &request));
    } else {
        for line in io::stdin().lock().lines() {
            match line {
                Ok(request) => println!("{}", gamepack_core::dispatch(&root, &request)),
                Err(error) => {
                    eprintln!("Cannot read request: {error}");
                    std::process::exit(1);
                }
            }
        }
    }
}
