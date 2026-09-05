import { render } from 'solid-js/web';
import { Router, Route } from '@solidjs/router';
import { AuthProvider } from './auth';
import { FeedbackProvider } from './ui';
import { Shell } from './shell';
import { Login, Password } from './pages/auth';
import { Dashboard } from './pages/dashboard';
import { Catalog } from './pages/catalog';
import { Classes, ClassPage } from './pages/classes';
import { Sessions, Attendance } from './pages/attendance';
import { Reports, Warnings, Audits } from './pages/reports';
import { Empty } from './ui';
import 'virtual:uno.css';
import './styles.css';

render(
  () => (
    <Router
      root={(props) => (
        <AuthProvider>
          <FeedbackProvider>
            <Shell>{props.children}</Shell>
          </FeedbackProvider>
        </AuthProvider>
      )}
    >
      <Route path="/" component={Dashboard} />
      <Route path="/login" component={Login} />
      <Route path="/password" component={Password} />
      <Route path="/campuses" component={() => <Catalog entity="campuses" />} />
      <Route path="/courses" component={() => <Catalog entity="courses" />} />
      <Route path="/students" component={() => <Catalog entity="students" />} />
      <Route path="/teachers" component={() => <Catalog entity="users" />} />
      <Route path="/classes" component={Classes} />
      <Route path="/classes/:id" component={ClassPage} />
      <Route path="/sessions" component={Sessions} />
      <Route path="/attendance/:id" component={Attendance} />
      <Route path="/reports" component={Reports} />
      <Route path="/warnings" component={Warnings} />
      <Route path="/audits" component={Audits} />
      <Route
        path="*"
        component={() => <Empty title="页面不存在" description="请从左侧导航选择需要的功能。" />}
      />
    </Router>
  ),
  document.getElementById('root')!,
);
