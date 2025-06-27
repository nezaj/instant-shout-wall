"use client";

import React, { useState, useEffect, useContext } from "react";
import { id, lookup, InstaQLEntity, User } from "@instantdb/react";

import db from "../lib/db";
import schema from "../instant.schema";

type ProfileWithAvatar = InstaQLEntity<typeof schema, "profiles", { avatar: {} }>;
type PostsWithProfile = InstaQLEntity<typeof schema, "posts", { author: {} }>;

interface AuthProfileContextValue {
  user: User | null | undefined;
  profile: ProfileWithAvatar | undefined;
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

async function createProfile(userId: string) {
  // IMPORTANT: transact is how you write data to the database
  // We want to block until the profile is created, so we use await
  await db.transact(
    db.tx.profiles[userId].update({
      handle: randomHandle(),
    }).link({ user: userId })
  );
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
        avatar: {}
      },
    } : null
  );

  const profile = data?.profiles?.[0];

  // We create a profile if it doesn't exist. We use the profile namespace to
  // connect user data to other namespaces like $files
  useEffect(() => {
    if (!user || profileLoading || profile) return;
    createProfile(user.id);
  }, [user, profileLoading, profile]);

  const value = {
    user,
    profile,
    isLoading: authLoading || !!(user && !profile),
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
  if (isLoading) { return; }
  if (error) { return <div className="p-4 text-red-500">Uh oh! {error.message}</div>; }
  if (user && profile) { return <Main user={user} profile={profile} />; }
  return <Login />;
}

function ProfileAvatar({ profile, user }: { profile: ProfileWithAvatar, user: User }) {
  const [isUploading, setIsUploading] = useState(false);
  const avatarPath = `${user.id}/avatar`;

  const handleAvatarDelete = async () => {
    if (!profile.avatar) return;
    // IMPORTANT: lookup lets you find the id by a field value. This only works if the
    // field is unqiue
    db.transact(db.tx.$files[lookup("path", avatarPath)].delete());
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      // Upload file with user-specific path
      const { data } = await db.storage.uploadFile(avatarPath, file);

      // Link to profile
      await db.transact(
        db.tx.profiles[profile.id].link({ avatar: data.id })
      );
    } catch (error) {
      console.error('Upload failed:', error);
    }
    setIsUploading(false);
  };

  return (
    <div className="flex items-center space-x-3 p-4">
      <label className="relative cursor-pointer">
        {profile.avatar ? (
          <img
            src={profile.avatar.url}
            alt={profile.handle}
            className="w-12 h-12 rounded-full object-cover"
          />
        ) : (
          <div className="w-12 h-12 bg-gray-500 rounded-full flex items-center justify-center text-white font-bold text-lg">
            {profile.handle[0].toUpperCase()}
          </div>
        )}

        {isUploading && (
          <div className="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        <input
          type="file"
          accept="image/*"
          onChange={handleAvatarUpload}
          className="hidden"
          disabled={isUploading}
        />
      </label>
      <div>
        <div>Profile: {profile.handle}</div>
        <div>Email: {user.email}</div>
        <button
          onClick={handleAvatarDelete}
          className="text-red-500 hover:text-red-700 disabled:text-gray-400 hover:cursor-pointer disabled:hover:cursor-not-allowed"
          disabled={!profile.avatar || isUploading}>
          Delete Avatar
        </button>

      </div>
    </div>
  );
}

function Main({ user, profile }: { user: User, profile: ProfileWithAvatar }) {
  const { isLoading, error, data } = db.useQuery({
    todos: {},
    posts: {
      $: {
        order: { createdAt: "desc" },
        limit: 10,
      },
      author: {},
    },
  });

  // IMPORTANT: usePresence is how you subscribe to presence data
  const { peers } = db.rooms.usePresence(room);
  const numUsers = 1 + Object.keys(peers).length;

  // IMPORTANT: useTopicEffect is how you react to topic messages
  db.rooms.useTopicEffect(room, 'shout', (message) => {
    addShout(message);
  });

  if (isLoading) {
    return;
  }
  if (error) {
    return <div className="text-red-500 p-4">Error: {error.message}</div>;
  }
  const { posts } = data;
  return (

    <div>
      <ProfileAvatar profile={profile} user={user} />
      <div className="font-mono flex items-center flex-col space-y-4">
        <div className="text-xs text-gray-500">
          Number of users online: {numUsers}
        </div>
        <div className="border border-gray-300 max-w-xs w-full">
          <PostForm />
          <PostList posts={posts} />
        </div>
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
      <input ref={inputRef} type="email" className="border border-gray-300 px-3 py-1  w-full" placeholder="Enter your email" required autoFocus />
      <button type="submit" className="px-3 py-1 bg-blue-600 text-white font-bold hover:bg-blue-700 w-full" >
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
      <input ref={inputRef} type="text" className="border border-gray-300 px-3 py-1  w-full" placeholder="123456..." required autoFocus />
      <button type="submit" className="px-3 py-1 bg-blue-600 text-white font-bold hover:bg-blue-700 w-full" >
        Verify Code
      </button>
    </form>
  );
}



// Write Data
// ---------
function addPost(text: string, authorId: string | undefined) {
  db.transact(
    // IMPORTANT: ids must be a valid UUID, so we use `id()` to generate one
    db.tx.posts[id()].update({
      text,
      createdAt: Date.now(),
    }).link({ author: authorId })
  );
}

function deletePost(postId: string) {
  db.transact(db.tx.posts[postId].delete());
}


// 
// ---------
function makeShout(text: string) {
  const maxX = window.innerWidth - 200; // Leave some margin
  const maxY = window.innerHeight - 100;
  return {
    text,
    x: Math.random() * maxX,
    y: Math.random() * maxY,
    angle: (Math.random() - 0.5) * 30,
    size: Math.random() * 20 + 18,
  };
}

function addShout({ text, x, y, angle, size }: { text: string, x: number, y: number, angle: number, size: number }) {
  const shoutElement = document.createElement('div');
  shoutElement.textContent = text;
  shoutElement.style.cssText = `
    left: ${x}px;
    top: ${y}px;
    position: fixed;
    z-index: 9999;
    font-size: ${size}px;
    font-weight: bold;
    pointer-events: none;
    transition: opacity 2s ease-out;
    opacity: 1;
    font-family: system-ui, -apple-system, sans-serif;
    white-space: nowrap;
    transform: rotate(${angle}deg);
  `;
  document.body.appendChild(shoutElement);
  setTimeout(() => {
    shoutElement.style.opacity = '0';
  }, 100);
  setTimeout(() => {
    shoutElement.remove();
  }, 2100);
}

function PostForm() {
  const { user } = db.useAuth();
  const [value, setValue] = useState("");

  // IMPORTANT: usePublishTopic returns a function that can be used to publish
  // a message to a topic
  const publishShout = db.rooms.usePublishTopic(room, 'shout');

  const handleSubmit = (action: string) => {
    if (action === 'post') {
      addPost(value, user?.id);
    } else {
      const params = makeShout(value);
      addShout(params);
      publishShout(params);
    }
    setValue("");
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center h-10 border-b border-gray-300">
        <input
          className="flex-1 h-full px-2 outline-none bg-transparent"
          autoFocus
          placeholder="What do you want to say?"
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </div>
      <div className="flex justify-around border-gray-300 h-6">
        <button
          className="px-3 hover:bg-gray-100"
          onClick={() => handleSubmit('post')}
        >
          Post
        </button>
        <button
          className="px-3 hover:bg-gray-100"
          onClick={() => handleSubmit('shout')}
        >
          Shout
        </button>
      </div>
    </div >
  );
}

function PostList({ posts }: { posts: PostsWithProfile[] }) {
  const { user } = db.useAuth();
  return (
    <div className="divide-y divide-gray-300">
      {posts.map((post) => (
        <div key={post.id} className="flex items-center h-10">
          <div className="flex-1 px-2 overflow-hidden flex justify-between items-center">
            <span>{post.text}</span>
            {post.author?.id === user?.id && (
              <button onClick={() => deletePost(post.id)} className="text-xs text-gray-500 hover:cursor-pointer">x</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export default App;
