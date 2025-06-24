"use client";

import React, { useState, useEffect, useContext } from "react";
import { id, InstaQLEntity, User } from "@instantdb/react";

import db from "../lib/db";
import schema from "../instant.schema";

type Todo = InstaQLEntity<typeof schema, "todos">;
type Profile = InstaQLEntity<typeof schema, "profiles">;

interface AuthProfileContextValue {
  user: User | null | undefined;
  profile: Profile | undefined;
  isLoading: boolean;
  error: { message: string } | undefined;
}

const AuthProfileContext = React.createContext<AuthProfileContextValue | null>(null);

function randomHandle() {
  const adjectives = ["Quick", "Lazy", "Happy", "Sad", "Bright", "Dark"];
  const nouns = ["Fox", "Dog", "Cat", "Bird", "Fish", "Mouse"];
  const randomAdjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const randomNoun = nouns[Math.floor(Math.random() * nouns.length)];
  const randomSuffix = Math.floor(Math.random() * 9000) + 1000
  return `${randomAdjective}${randomNoun}${randomSuffix}`;
}

function AuthProfileProvider({ children }: { children: React.ReactNode }) {
  const { isLoading: authLoading, user, error: authError } = db.useAuth();
  // useQuery is how you subscribe to DB data
  const { isLoading: profileLoading, data, error: profileError } = db.useQuery(
    // We can use a conditional query to fetch the profile only if the user is
    // logged in
    user ? {
      profiles: {
        $: {
          where: { "user.id": user.id },
        },
      },
    } : {}
  );

  const profile = data?.profiles?.[0];

  // We create a profile if it doesn't exist. We use the profile namespace to
  // connect user data to other namespaces like $files
  useEffect(() => {
    if (!user || profileLoading || profile) return;
    // transact is how you write data to the database
    db.transact(
      // ids must be a valid UUID, so we use `id()` to generate one
      db.tx.profiles[id()].update({
        handle: randomHandle(),
      }).link({ user: user.id })
    );
  }, [user, profileLoading, profile]);

  const value = {
    user,
    profile,
    isLoading: authLoading || profileLoading,
    error: authError || profileError,
  };

  return (
    <AuthProfileContext.Provider value={value}>
      {children}
    </AuthProfileContext.Provider>
  );
}

export function useAuthProfile() {
  const context = useContext(AuthProfileContext);
  if (!context) {
    throw new Error("useAuthProfile must be used within AuthProfileProvider");
  }
  return context;
}

const room = db.room("todos", "main");

function App() {
  return (
    <AuthProfileProvider>
      <AppContent />
    </AuthProfileProvider>
  )
}

function AppContent() {
  const { user, profile, isLoading, error } = useAuthProfile();

  if (isLoading || !profile) { return; }
  if (error) { return <div className="p-4 text-red-500">Uh oh! {error.message}</div>; }
  if (user) { return <Main user={user} profile={profile} />; }
  return <Login />;
}

function Main({ user, profile }: { user: User, profile: Profile }) {
  const { isLoading, error, data } = db.useQuery({
    todos: {},
  });

  // usePresence is how you subscribe to presence data
  const { peers } = db.rooms.usePresence(room);
  const numUsers = 1 + Object.keys(peers).length;

  if (isLoading) {
    return;
  }
  if (error) {
    return <div className="text-red-500 p-4">Error: {error.message}</div>;
  }
  const { todos } = data;
  return (

    <div className="font-mono min-h-screen flex justify-center items-center flex-col space-y-4">
      <div className="flex items-center space-x-3 p-4">
        <div className="w-12 h-12 bg-gray-500 rounded-full flex items-center justify-center text-white font-bold text-lg">
          {profile.handle[0].toUpperCase()}
        </div>
        <div>
          <div>Profile: {profile.handle}</div>
          <div>Email: {user.email}</div>
        </div>
      </div>

      <div className="text-xs text-gray-500">
        Number of users online: {numUsers}
      </div>
      <h2 className="tracking-wide text-5xl text-gray-300">todos</h2>
      <div className="border border-gray-300 max-w-xs w-full">
        <TodoForm todos={todos} />
        <TodoList todos={todos} />
        <ActionBar todos={todos} />
      </div>
      <div className="text-xs text-center">
        Open another tab to see todos update in realtime!
      </div>

    </div>
  );
}

function Login() {
  const [sentEmail, setSentEmail] = useState("");

  return (
    <div className="flex justify-center items-center min-h-screen">
      <div className="max-w-sm">
        {!sentEmail ? (
          <EmailStep onSendEmail={setSentEmail} />
        ) : (
          <CodeStep sentEmail={sentEmail} />
        )}
      </div>
    </div>
  );
}

function EmailStep({ onSendEmail }: { onSendEmail: (email: string) => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const inputEl = inputRef.current!;
    const email = inputEl.value;
    onSendEmail(email);
    db.auth.sendMagicCode({ email }).catch((err) => {
      alert("Uh oh :" + err.body?.message);
      onSendEmail("");
    });
  };
  return (
    <form
      key="email"
      onSubmit={handleSubmit}
      className="flex flex-col space-y-4"
    >
      <h2 className="text-xl font-bold">Instant Demo app</h2>
      <p className="text-gray-700">
        This is a demo app for InstantDB with the following features:
      </p>
      <ul className="list-disc pl-5 space-y-1">
        <li>Initiailizes a connection to InstantDB</li>
        <li>Defines schema and permissions for the app</li>
        <li>Authentication with magic codes</li>
        <li>Reads and writes data via `db.useQuery` and `db.transact`</li>
        <li>Ephemeral features like who's online</li>
        <li>File uploads for avatars</li>
      </ul>

      <p className="text-gray-700">
        To try the app, enter your email, and we'll send you a verification code. We'll create
        an account for you too if you don't already have one.
      </p>
      <input
        ref={inputRef}
        type="email"
        className="border border-gray-300 px-3 py-1  w-full"
        placeholder="Enter your email"
        required
        autoFocus
      />
      <button
        type="submit"
        className="px-3 py-1 bg-blue-600 text-white font-bold hover:bg-blue-700 w-full"
      >
        Send Code
      </button>
    </form>
  );
}

function CodeStep({ sentEmail }: { sentEmail: string }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const inputEl = inputRef.current!;
    const code = inputEl.value;
    db.auth.signInWithMagicCode({ email: sentEmail, code }).catch((err) => {
      inputEl.value = "";
      alert("Uh oh :" + err.body?.message);
    });
  };

  return (
    <form
      key="code"
      onSubmit={handleSubmit}
      className="flex flex-col space-y-4"
    >
      <h2 className="text-xl font-bold">Enter your code</h2>
      <p className="text-gray-700">
        We sent an email to <strong>{sentEmail}</strong>. Check your email, and
        paste the code you see.
      </p>
      <input
        ref={inputRef}
        type="text"
        className="border border-gray-300 px-3 py-1  w-full"
        placeholder="123456..."
        required
        autoFocus
      />
      <button
        type="submit"
        className="px-3 py-1 bg-blue-600 text-white font-bold hover:bg-blue-700 w-full"
      >
        Verify Code
      </button>
    </form>
  );
}



// Write Data
// ---------
function addTodo(text: string) {
  db.transact(
    db.tx.todos[id()].update({
      text,
      done: false,
      createdAt: Date.now(),
    })
  );
}

function deleteTodo(todo: Todo) {
  db.transact(db.tx.todos[todo.id].delete());
}

function toggleDone(todo: Todo) {
  db.transact(db.tx.todos[todo.id].update({ done: !todo.done }));
}

function deleteCompleted(todos: Todo[]) {
  const completed = todos.filter((todo) => todo.done);
  const txs = completed.map((todo) => db.tx.todos[todo.id].delete());
  db.transact(txs);
}

function toggleAll(todos: Todo[]) {
  const newVal = !todos.every((todo) => todo.done);
  db.transact(
    todos.map((todo) => db.tx.todos[todo.id].update({ done: newVal }))
  );
}


// Components
// ----------
function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 20 20">
      <path
        d="M5 8 L10 13 L15 8"
        stroke="currentColor"
        fill="none"
        strokeWidth="2"
      />
    </svg>
  );
}

function TodoForm({ todos }: { todos: Todo[] }) {
  return (
    <div className="flex items-center h-10 border-b border-gray-300">
      <button
        className="h-full px-2 border-r border-gray-300 flex items-center justify-center"
        onClick={() => toggleAll(todos)}
      >
        <div className="w-5 h-5">
          <ChevronDownIcon />
        </div>
      </button>
      <form
        className="flex-1 h-full"
        onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.input as HTMLInputElement;
          addTodo(input.value);
          input.value = "";
        }}
      >
        <input
          className="w-full h-full px-2 outline-none bg-transparent"
          autoFocus
          placeholder="What needs to be done?"
          type="text"
          name="input"
        />
      </form>
    </div>
  );
}

function TodoList({ todos }: { todos: Todo[] }) {
  return (
    <div className="divide-y divide-gray-300">
      {todos.map((todo) => (
        <div key={todo.id} className="flex items-center h-10">
          <div className="h-full px-2 flex items-center justify-center">
            <div className="w-5 h-5 flex items-center justify-center">
              <input
                type="checkbox"
                className="cursor-pointer"
                checked={todo.done}
                onChange={() => toggleDone(todo)}
              />
            </div>
          </div>
          <div className="flex-1 px-2 overflow-hidden flex items-center">
            {todo.done ? (
              <span className="line-through">{todo.text}</span>
            ) : (
              <span>{todo.text}</span>
            )}
          </div>
          <button
            className="h-full px-2 flex items-center justify-center text-gray-300 hover:text-gray-500"
            onClick={() => deleteTodo(todo)}
          >
            X
          </button>
        </div>
      ))}
    </div>
  );
}

function ActionBar({ todos }: { todos: Todo[] }) {
  return (
    <div className="flex justify-between items-center h-10 px-2 text-xs border-t border-gray-300">
      <div>Remaining todos: {todos.filter((todo) => !todo.done).length}</div>
      <button
        className=" text-gray-300 hover:text-gray-500"
        onClick={() => deleteCompleted(todos)}
      >
        Delete Completed
      </button>
    </div>
  );
}

export default App;
